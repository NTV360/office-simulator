import { Controller, Get, Inject, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { SameOriginGuard, SessionGuard } from '../auth/auth.controller';
import { EmployeeService, type AttendanceSummary } from './employee.service';

/**
 * Who is absent today, for the "Absent" tab of the page's ledger. Names only (no ids, departments or times), and only for a signed-in account.
 * (This is `main`'s `GET /api/attendance/summary`; the page shows the names and nothing else is sent.)
 */
@Controller('attendance')
@UseGuards(SameOriginGuard, SessionGuard)
export class AttendanceController {
  constructor(@Inject(EmployeeService) private readonly employees: EmployeeService) {}

  @Get('summary')
  async summary(): Promise<AttendanceSummary> {
    const summary = await this.employees.attendanceSummary();
    if (!summary) throw new ServiceUnavailableException('the attendance list is not available');
    return summary;
  }
}
