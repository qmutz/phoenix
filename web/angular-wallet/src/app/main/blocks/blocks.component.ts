import {Component, ViewChild} from '@angular/core';
import { MatPaginator } from '@angular/material/paginator';
import { MatSort } from '@angular/material/sort';
import { MatTableDataSource } from '@angular/material/table';
import {Account, Block} from '@burstjs/core';
import {FormControl} from '@angular/forms';
import {NotifierService} from 'angular-notifier';
import {convertBurstTimeToDate, convertNQTStringToNumber} from '@burstjs/util';
import {NetworkService} from 'app/network/network.service';
import {ActivatedRoute} from '@angular/router';
import { StoreService } from 'app/store/store.service';

@Component({
  selector: 'app-blocks',
  styleUrls: ['./blocks.component.scss'],
  templateUrl: './blocks.component.html'
})
export class BlocksComponent {
  public dataSource: MatTableDataSource<Block>;
  public convertNQTStringToNumber = convertNQTStringToNumber;
  public displayedColumns: string[];
  private account: Account;
  pickerFromField = new FormControl();
  pickerToField = new FormControl();


  @ViewChild(MatPaginator, { static: true }) paginator: MatPaginator;
  @ViewChild(MatSort, { static: true }) sort: MatSort;

  constructor(
    private networkService: NetworkService,
    private notifierService: NotifierService,
    private storeService: StoreService,
    private route: ActivatedRoute
  ) {
  }

  public async ngOnInit() {
    this.displayedColumns = ['block', 'height', 'numberOfTransactions', 'timestamp', 'totalAmountNQT', 'totalFeeNQT'];
    this.dataSource = new MatTableDataSource<Block>();
    this.dataSource.data = this.route.snapshot.data.blocks.blocks;
    this.networkService.setBlocks(this.dataSource.data);
    this.networkService.blocks.subscribe((blocks) => {
      this.dataSource.data = blocks;
    });
  }

  public ngAfterViewInit() {
    const defaultFilterPredicate = this.dataSource.filterPredicate;
    this.dataSource.paginator = this.paginator;
    this.dataSource.sort = this.sort;
    this.dataSource.filterPredicate = (data, filterValue: string) => {
      let withinRange = true;
      if (this.pickerFromField.value && this.pickerToField.value) {
        withinRange = this.convertTimestamp(data.timestamp) > this.pickerFromField.value &&
          this.convertTimestamp(data.timestamp) < this.pickerToField.value;
      } else if (this.pickerFromField.value) {
        withinRange = this.convertTimestamp(data.timestamp) > this.pickerFromField.value;
      } else if (this.pickerToField.value) {
        withinRange = this.convertTimestamp(data.timestamp) < this.pickerToField.value;
      }
      return withinRange && defaultFilterPredicate(data, filterValue);
    };
  }

  public applyFilter(filterValue: string) {
    filterValue = filterValue.trim();
    filterValue = filterValue.toLowerCase();
    this.dataSource.filter = filterValue || 'burst';
  }

    public isOwnAccount(address: string): boolean {
        return address != undefined && address == this.account.accountRS;
    }

  public convertTimestamp(timestamp: number): Date {
    return convertBurstTimeToDate(timestamp);
  }
}
