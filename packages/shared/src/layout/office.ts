import data from './office.json';
import type { LayoutData } from './layout';

/** The real office, as dumped from the client's furniture code (`npm run layout:dump`). */
export const officeLayout = data as unknown as LayoutData;
