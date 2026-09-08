import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { sumMoney, round2 } from './performance.constants';

/**
 * Resolves system-derived KPI actuals by querying the authoritative module.
 * Never duplicates calculation logic of other modules.
 */
@Injectable()
export class SystemKpiSourceService {
  constructor(private prisma: PrismaService) {}

  async resolve(companyId: string, sourceKey: string, employee: { id: string; firstName: string; lastName: string; employeeNo: string }, from: Date, to: Date): Promise<{ value: number | null; note: string } | null> {
    const fullName = `${employee.firstName} ${employee.lastName}`.trim();
    const fromDay = new Date(new Date(from).setHours(0, 0, 0, 0));
    const toDay = new Date(new Date(to).setHours(23, 59, 59, 999));

    switch (sourceKey) {
      case 'SALES_POSTED': {
        const invs = await this.prisma.salesInvoice.findMany({
          where: { companyId, salesperson: fullName, invoiceStatus: { in: ['POSTED', 'PAID', 'PART_PAID'] }, invoiceDate: { gte: fromDay, lte: toDay } },
          select: { total: true, invoiceStatus: true },
        });
        return { value: round2(sumMoney(invs.map((i) => i.total))), note: `${invs.length} posted invoice(s) for ${fullName}` };
      }
      case 'SALES_COLLECTED': {
        const invs = await this.prisma.salesInvoice.findMany({
          where: { companyId, salesperson: fullName, invoiceStatus: { in: ['POSTED', 'PAID', 'PART_PAID'] }, invoiceDate: { gte: fromDay, lte: toDay } },
          select: { amountPaid: true },
        });
        return { value: round2(sumMoney(invs.map((i) => i.amountPaid))), note: 'Collected payments on employee\'s posted invoices' };
      }
      case 'SALES_NEW_CUSTOMERS': {
        const count = await this.prisma.customer.count({
          where: { companyId, invoices: { some: { salesperson: fullName, invoiceStatus: { in: ['POSTED', 'PAID', 'PART_PAID'] }, invoiceDate: { gte: fromDay, lte: toDay } } } },
        });
        return { value: count, note: 'New customers with posted invoices assigned to this employee in period' };
      }
      case 'CRM_WON_OPPORTUNITIES': {
        const count = await this.prisma.opportunity.count({ where: { companyId, assignee: fullName, stage: 'WON', actualCloseAt: { gte: fromDay, lte: toDay } } });
        return { value: count, note: 'Opportunities won in period' };
      }
      case 'CRM_WON_VALUE': {
        const aggr = await this.prisma.opportunity.aggregate({ where: { companyId, assignee: fullName, stage: 'WON', actualCloseAt: { gte: fromDay, lte: toDay } }, _sum: { wonValue: true } });
        return { value: round2(Number(aggr._sum.wonValue || 0)), note: 'Won opportunity value in period' };
      }
      case 'ATTENDANCE_PCT': {
        const records = await this.prisma.attendance.findMany({ where: { companyId, employeeId: employee.id, date: { gte: fromDay, lte: toDay } }, select: { status: true } });
        if (!records.length) return { value: null, note: 'No attendance records in period' };
        const present = records.filter((r) => r.status !== 'ABSENT').length;
        return { value: round2((present / records.length) * 100), note: `${present}/${records.length} days present` };
      }
      case 'ATTENDANCE_LATE': {
        const count = await this.prisma.attendance.count({ where: { companyId, employeeId: employee.id, date: { gte: fromDay, lte: toDay }, lateMinutes: { gt: 0 } } });
        return { value: count, note: 'Late arrivals in period' };
      }
      case 'ATTENDANCE_ABSENCE': {
        const count = await this.prisma.attendance.count({ where: { companyId, employeeId: employee.id, date: { gte: fromDay, lte: toDay }, status: 'ABSENT' } });
        return { value: count, note: 'Absence days in period' };
      }
      case 'ATTENDANCE_OVERTIME': {
        const aggr = await this.prisma.attendance.aggregate({ where: { companyId, employeeId: employee.id, date: { gte: fromDay, lte: toDay }, approved: true }, _sum: { overtimeHours: true } });
        return { value: round2(Number(aggr._sum.overtimeHours || 0)), note: 'Approved overtime hours' };
      }
      case 'QA_AVERAGE_SCORE': {
        const rows = await this.prisma.qaAssessment.findMany({ where: { companyId, employeeId: employee.id, createdAt: { gte: fromDay, lte: toDay } }, select: { overallScore: true } });
        if (!rows.length) return { value: null, note: 'No QA assessments in period' };
        const avg = rows.reduce((s, r) => s + Number(r.overallScore || 0), 0) / rows.length;
        return { value: round2(avg), note: `${rows.length} QA assessment(s) averaged` };
      }
      case 'QA_FAILED_REVIEWS': {
        const rows = await this.prisma.qaAssessment.findMany({ where: { companyId, employeeId: employee.id, createdAt: { gte: fromDay, lte: toDay } }, select: { overallScore: true, template: { select: { passThreshold: true } } } });
        const failed = rows.filter((r) => Number(r.overallScore || 0) < Number(r.template?.passThreshold ?? 70)).length;
        return { value: failed, note: 'QA reviews below pass threshold' };
      }
      case 'PROJECTS_TASKS_COMPLETED': {
        // ProjectTask has no assignee link yet — surface "no data" so the reviewer records it manually.
        return { value: null, note: 'Project tasks are not assigned to employees yet — record the actual value manually' };
      }
      default:
        return null;
    }
  }
}
