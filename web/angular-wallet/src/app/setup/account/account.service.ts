import {Injectable} from '@angular/core';
import {BehaviorSubject} from 'rxjs/BehaviorSubject';
import 'rxjs/add/operator/toPromise';
import 'rxjs/add/operator/timeout';
import semver from 'semver';

import {StoreService} from 'app/store/store.service';
import {Settings} from 'app/settings';
import {
  Account,
  AliasList,
  Api,
  Balance,
  TransactionId,
  TransactionList,
  UnconfirmedTransactionList,
  Transaction
} from '@burstjs/core';
import {decryptAES, encryptAES, generateMasterKeys, getAccountIdFromPublicKey, hashSHA256, Keys} from '@burstjs/crypto';
import {
  convertAddressToNumericId,
  convertNumericIdToAddress,
  isBurstAddress,
  sumNQTStringToNumber
} from '@burstjs/util';
import {ApiService} from '../../api.service';
import {I18nService} from 'app/layout/components/i18n/i18n.service';
import {constants} from 'app/constants';

interface SetAccountInfoRequest {
  name: string;
  description: string;
  deadline: number;
  feeNQT: string;
  pin: string;
  keys: Keys;
}

interface SetRewardRecipientRequest {
  recipient: string;
  deadline: number;
  feeNQT: string;
  pin: string;
  keys: Keys;
}

interface SetAliasRequest {
  aliasName: string;
  aliasURI: string;
  deadline: number;
  feeNQT: string;
  pin: string;
  keys: Keys;
}

interface NodeDescriptor {
  url: string;
  version: string;
}


@Injectable({
  providedIn: 'root'
})
export class AccountService {
  public currentAccount: BehaviorSubject<Account> = new BehaviorSubject(undefined);
  private api: Api;
  private selectedNode: NodeDescriptor;

  // a simple string cache of transaction ids for which the user
  // has already received a push notification
  private transactionsSeenInNotifications: string[] = [];

  constructor(private storeService: StoreService, private apiService: ApiService, private i18nService: I18nService) {
    this.storeService.settings.subscribe((settings: Settings) => {
      this.api = this.apiService.api;
      this.selectedNode = {
        url: settings.node,
        version: settings.nodeVersion
      };
    });
  }

  public setCurrentAccount(account: Account): void {
    this.currentAccount.next(account);
  }

  public async getAccountTransactions(id: string, firstIndex?: number, lastIndex?: number, numberOfConfirmations?: number, type?: number, subtype?: number): Promise<TransactionList> {
    try{
      const includeMultiouts = semver.gte(this.selectedNode.version, constants.multiOutMinVersion, {includePrerelease: true}) || undefined;
      const transactions = await this.api.account.getAccountTransactions(
        id, firstIndex, lastIndex, numberOfConfirmations, type, subtype, includeMultiouts);
      return Promise.resolve(transactions);
    }catch (e){
      // defensive programming: fallback, in case of multiout not accepted
      const EC_INVALID_ARG = 4;
      if (e.data.errorCode === EC_INVALID_ARG){
        return this.api.account.getAccountTransactions(id, firstIndex, lastIndex, numberOfConfirmations, type, subtype);
      }
      else{
        throw e;
      }
    }
  }

  public generateSendTransactionQRCodeAddress(
    id: string,
    amountNQT?: number,
    feeSuggestionType?: string,
    feeNQT?: number,
    immutable?: boolean): Promise<string> {
    return this.api.account.generateSendTransactionQRCodeAddress(
      id,
      amountNQT,
      feeSuggestionType,
      feeNQT,
      immutable
    );
  }

  public getAlias(name: string): Promise<any> {
    return this.api.alias.getAliasByName(name);
  }

  public getAliases(id: string): Promise<AliasList> {
    return this.api.account.getAliases(id);
  }

  public setAlias({aliasName, aliasURI, feeNQT, deadline, pin, keys}: SetAliasRequest): Promise<TransactionId> {
    const senderPrivateKey = decryptAES(keys.signPrivateKey, hashSHA256(pin));
    return this.api.account.setAlias(aliasName, aliasURI, feeNQT, keys.publicKey, senderPrivateKey, deadline);
  }

  public getAccountBalance(id: string): Promise<Balance> {
    return this.api.account.getAccountBalance(id);
  }

  public getUnconfirmedTransactions(id: string): Promise<UnconfirmedTransactionList> {
    return this.api.account.getUnconfirmedAccountTransactions(id);
  }

  public getAccount(id: string): Promise<Account> {
    return this.api.account.getAccount(id);
  }

  public getCurrentAccount(): Promise<Account> {
    return Promise.resolve(this.currentAccount.getValue());
  }

  public setAccountInfo({name, description, feeNQT, deadline, pin, keys}: SetAccountInfoRequest): Promise<TransactionId> {
    const senderPrivateKey = decryptAES(keys.signPrivateKey, hashSHA256(pin));
    return this.api.account.setAccountInfo(name, description, feeNQT, keys.publicKey, senderPrivateKey, deadline);
  }

  public setRewardRecipient({recipient, feeNQT, deadline, pin, keys}: SetRewardRecipientRequest): Promise<TransactionId> {
    const senderPrivateKey = decryptAES(keys.signPrivateKey, hashSHA256(pin));
    return this.api.account.setRewardRecipient(recipient, feeNQT, keys.publicKey, senderPrivateKey, deadline);
  }

  /*
  * Method responsible for creating a new active account from a passphrase.
  * Generates keys for an account, encrypts them with the provided key and saves them.
  * TODO: error handling of asynchronous method calls
  */
  public createActiveAccount({passphrase, pin = ''}): Promise<Account> {
    return new Promise(async (resolve, reject) => {
      const account: Account = new Account();
      // import active account
      account.type = 'active';
      account.confirmed = false;
      const keys = generateMasterKeys(passphrase);
      const encryptedKey = encryptAES(keys.signPrivateKey, hashSHA256(pin));
      const encryptedSignKey = encryptAES(keys.agreementPrivateKey, hashSHA256(pin));

      account.keys = {
        publicKey: keys.publicKey,
        signPrivateKey: encryptedKey,
        agreementPrivateKey: encryptedSignKey
      };
      account.pinHash = hashSHA256(pin + keys.publicKey);

      const id = getAccountIdFromPublicKey(keys.publicKey);
      account.account = id;
      account.accountRS = convertNumericIdToAddress(id);

      await this.selectAccount(account);
      const savedAccount = await this.synchronizeAccount(account);
      resolve(savedAccount);
    });
  }

  /*
  * Method responsible for importing an offline account.
  * Creates an account object with no keys attached.
  */
  public createOfflineAccount(address: string): Promise<Account> {
    return new Promise(async (resolve, reject) => {

      if (!isBurstAddress(address)) {
        reject('Invalid Burst Address');
      }

      const account: Account = new Account();
      const accountId = convertAddressToNumericId(address);
      const existingAccount = await this.storeService.findAccount(accountId);
      if (existingAccount === undefined) {
        // import offline account
        account.type = 'offline';
        account.confirmed = false;
        account.accountRS = address;
        account.account = accountId;
        await this.selectAccount(account);
        const savedAccount = await this.synchronizeAccount(account);
        resolve(savedAccount);
      } else {
        reject('Burstcoin address already imported!');
      }
    });
  }

  /*
  * Method responsible for removing an existing account.
  */
  public removeAccount(account: Account): Promise<boolean> {
    return this.storeService.removeAccount(account).catch(error => error);
  }

  /*
  * Method responsible for selecting a different account.
  */
  public selectAccount(account: Account): Promise<Account> {
    return new Promise((resolve, reject) => {
      this.storeService.selectAccount(account)
        .then(account => {
          this.synchronizeAccount(account);
        });
      this.setCurrentAccount(account);
      resolve(account);
    });
  }


  /*
  * Method responsible for synchronizing an account with the blockchain.
  */
  public synchronizeAccount(account: Account): Promise<Account> {
    return new Promise(async (resolve, reject) => {
      await Promise.all([
          this.syncAccountDetails(account),
          this.syncAccountTransactions(account),
          this.syncAccountUnconfirmedTransactions(account),
        ]
      );
      this.storeService.saveAccount(account).catch(error => {
        reject(error);
      });
      resolve(account);
    });
  }

  public isNewTransaction(transactionId: string): boolean {
    return (!this.transactionsSeenInNotifications[transactionId]);
  }

  public sendNewTransactionNotification(transaction: Transaction): void {
    this.transactionsSeenInNotifications[transaction.transaction] = true;
    const incoming = transaction.recipientRS === this.currentAccount.value.accountRS;
    const totalAmountBurst = sumNQTStringToNumber(transaction.amountNQT, transaction.feeNQT);

    // @ts-ignore
    return window.Notification && new window.Notification(incoming ?
      this.i18nService.getTranslation('youve_got_burst') :
      this.i18nService.getTranslation('you_sent_burst'),
      {
        body: `${totalAmountBurst} BURST`,
        title: 'Phoenix'
      });

  }

  private async syncAccountUnconfirmedTransactions(account: Account): Promise<void> {
    try {
      const unconfirmedTransactionsResponse = await this.getUnconfirmedTransactions(account.account);
      account.transactions = unconfirmedTransactionsResponse.unconfirmedTransactions
        .concat(account.transactions);

      // @ts-ignore - Send notifications for new transactions
      if (window.Notification) {
        unconfirmedTransactionsResponse.unconfirmedTransactions
          .sort((a, b) => a.timestamp > b.timestamp ? -1 : 1)
          .filter(({transaction}) => this.isNewTransaction(transaction))
          .map((transaction) => this.sendNewTransactionNotification(transaction));
      }
    } catch (e) {
      console.log(e);
    }
  }

  private async syncAccountTransactions(account: Account): Promise<void> {
    try {
      const transactionList = await this.getAccountTransactions(account.account, 0, 500);
      account.transactions = transactionList.transactions;
    } catch (e) {
      account.transactions = [];
      console.log(e);
    }
  }

  private async syncAccountDetails(account: Account): Promise<void> {
    try {
      const remoteAccount = await this.getAccount(account.account);
      account.name = remoteAccount.name;
      account.description = remoteAccount.description;
      account.assetBalances = remoteAccount.assetBalances;
      account.unconfirmedAssetBalances = remoteAccount.unconfirmedAssetBalances;
      account.balanceNQT = remoteAccount.balanceNQT;
      account.unconfirmedBalanceNQT = remoteAccount.unconfirmedBalanceNQT;
      // @ts-ignore
      account.confirmed = !!remoteAccount.publicKey;
    } catch (e) {
      account.confirmed = false;
      console.log(e);
    }
  }
}
