import {Injectable} from '@angular/core';
import Transport from '@ledgerhq/hw-transport';
import TransportWebUSB from '@ledgerhq/hw-transport-webusb';

@Injectable()
export class LedgerService {

  constructor() {
  }

  private async getTransport(): Transport {
    return await TransportWebUSB.create();
  }

  public async getPublicKey(accountIndex: number): Promise<Buffer> {
    const transport = this.getTransport();
    let accountIndexHex = accountIndex.toString(16);
    if (accountIndexHex.length === 1) {
      accountIndexHex = '0' + accountIndexHex;
    }
    console.log('accountIndexHex', accountIndexHex); // TODO
    const publicKey = await transport.exchange(Buffer.from('800400' + accountIndexHex + '00', 'hex'));
    console.log('publicKey', publicKey); // TODO
    return publicKey;
  }
}
