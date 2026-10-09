import { MemoryEmployeeStore } from './employee-store';
import { employeeStoreContract } from './employee-store.contract';

employeeStoreContract('the in-memory employee store', async () => new MemoryEmployeeStore());
