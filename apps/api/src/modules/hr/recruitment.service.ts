import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { NumberingService } from '../../core/common/numbering.service';
import { AuditService } from '../../core/common/audit.service';
import { companyIdOf } from '../../core/context';

export const PIPELINE_STAGES = ['APPLIED', 'SCREENING', 'SHORTLISTED', 'INTERVIEW', 'ASSESSMENT', 'OFFER', 'HIRED', 'REJECTED'];

const round2 = (n: number) => Number(n.toFixed(2));

@Injectable()
export class RecruitmentService {
  constructor(private prisma: PrismaService, private numbering: NumberingService, private audit: AuditService) {}

  private companyOf(req: any) { return companyIdOf(req.user); }

  // ---------- Dashboard ----------
  async dashboard(req: any) {
    const companyId = this.companyOf(req);
    const [openVacs, activeCands, offersPending, appsThisMonth, awaitingApproval, offersAccepted, hires, interviewsUpcoming, stale] = await Promise.all([
      this.prisma.jobVacancy.count({ where: { companyId, status: 'OPEN' } }),
      this.prisma.candidate.count({ where: { companyId, status: { in: ['ACTIVE', 'LEAD', 'HIRED'] } } }),
      this.prisma.offer.count({ where: { companyId, status: { in: ['PENDING_APPROVAL', 'APPROVED', 'SENT', 'VIEWED'] } } }),
      this.prisma.jobApplication.count({ where: { companyId, appliedAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } } }),
      this.prisma.recruitmentRequisition.count({ where: { companyId, status: { in: ['SUBMITTED', 'PENDING_APPROVAL'] } } }),
      this.prisma.offer.count({ where: { companyId, status: 'ACCEPTED' } }),
      this.prisma.jobApplication.count({ where: { companyId, stage: 'HIRED' } }),
      this.prisma.interview.count({ where: { companyId, status: 'SCHEDULED', scheduledAt: { gte: new Date(), lte: new Date(Date.now() + 7 * 86400000) } } }),
      this.prisma.jobApplication.count({ where: { companyId, status: 'ACTIVE', stage: { not: 'HIRED' }, appliedAt: { lte: new Date(Date.now() - 7 * 86400000) } } }),
    ]);
    const apps = await this.prisma.jobApplication.findMany({ where: { companyId }, select: { stage: true } });
    const funnel = PIPELINE_STAGES.map((s) => ({ stage: s, count: apps.filter((a) => a.stage === s).length }));
    const stageCount: Record<string, number> = {};
    for (const a of apps) stageCount[a.stage] = (stageCount[a.stage] || 0) + 1;
    return {
      openVacancies: openVacs,
      activeCandidates: activeCands,
      interviewsThisWeek: interviewsUpcoming,
      offersPending: offersPending,
      applicationsThisMonth: appsThisMonth,
      positionsAwaitingApproval: awaitingApproval,
      offersAcceptedHires: offersAccepted,
      timeToHire: await this.timeToHire(companyId),
      funnel,
      stageCount,
      needsAttention: {
        interviewsFeedbackPending: await this.prisma.interview.count({ where: { companyId, status: 'COMPLETED', scorecards: { none: {} } } }),
        offersExpiringSoon: await this.prisma.offer.count({ where: { companyId, status: { in: ['SENT', 'APPROVED'] }, expiryDate: { gte: new Date(), lte: new Date(Date.now() + 7 * 86400000) } } }),
        requisitionsAwaitingApproval: awaitingApproval,
        staleCandidates: stale,
      },
    };
  }

  private async timeToHire(companyId: string): Promise<number> {
    const hired = await this.prisma.jobApplication.findMany({ where: { companyId, stage: 'HIRED' }, select: { appliedAt: true, stageHistory: { where: { toStage: 'HIRED' }, orderBy: { at: 'asc' }, take: 1, select: { at: true } } } });
    let total = 0, n = 0;
    for (const h of hired) {
      const end = h.stageHistory[0]?.at;
      if (h.appliedAt && end) { total += (end.getTime() - h.appliedAt.getTime()) / 86400000; n++; }
    }
    return n ? round2(total / n) : 0;
  }

  // ---------- Requisitions ----------
  async createRequisition(req: any, dto: any) {
    const companyId = this.companyOf(req);
    const requesterId = req.user.sub;
    const requestedById = dto.requestedById || dto.hiringManagerId;
    const no = dto.requisitionNo || await this.numbering.next(companyId, 'REQ');
    const rec = await this.prisma.recruitmentRequisition.create({
      data: {
        companyId, requisitionNo: no, position: dto.position, departmentId: dto.departmentId, branchId: dto.branchId,
        hiringManagerId: dto.hiringManagerId, requestedById,
        projectId: dto.projectId, openings: dto.openings, employmentType: dto.employmentType || 'FULL_TIME',
        reason: dto.reason, primarySkills: dto.primarySkills, targetStartDate: dto.targetStartDate ? new Date(dto.targetStartDate) : undefined,
        priority: dto.priority || 'NORMAL', replacementFor: dto.replacementFor, costCentre: dto.costCentre,
        salaryMin: dto.salaryMin, salaryMax: dto.salaryMax, currency: dto.currency || 'USD', jobDescription: dto.jobDescription,
        requiredSkills: dto.requiredSkills, qualifications: dto.qualifications, experienceYears: dto.experienceYears, notes: dto.notes,
        status: 'DRAFT', activities: { create: { companyId, type: 'REQUISITION_CREATED', message: `Requisition ${no} created`, actorId: requesterId } },
      },
    });
    await this.audit.log(companyId, requesterId, 'CREATE', 'RecruitmentRequisition', rec.id, { requisitionNo: no });
    return rec;
  }

  async submitRequisition(req: any, id: string) {
    const companyId = this.companyOf(req);
    const rec = await this.prisma.recruitmentRequisition.findFirst({ where: { id, companyId } });
    if (!rec) throw new BadRequestException('Requisition not found');
    if (rec.status !== 'DRAFT') throw new BadRequestException('Only DRAFT requisitions can be submitted');
    const updated = await this.prisma.recruitmentRequisition.update({ where: { id }, data: { status: 'PENDING_APPROVAL', submittedAt: new Date(), activities: { create: { companyId, type: 'REQUISITION_SUBMITTED', message: `Requisition ${rec.requisitionNo} submitted for approval`, actorId: req.user.sub } } } });
    await this.audit.log(companyId, req.user.sub, 'SUBMIT', 'RecruitmentRequisition', id, { status: 'PENDING_APPROVAL' });
    return updated;
  }

  async approveRequisition(req: any, id: string) {
    const companyId = this.companyOf(req);
    const rec = await this.prisma.recruitmentRequisition.findFirst({ where: { id, companyId } });
    if (!rec) throw new BadRequestException('Requisition not found');
    if (!['PENDING_APPROVAL', 'SUBMITTED'].includes(rec.status)) throw new BadRequestException('Requisition is not awaiting approval');
    const updated = await this.prisma.recruitmentRequisition.update({ where: { id }, data: { status: 'APPROVED', approvedAt: new Date(), approvedById: req.user.sub, activities: { create: { companyId, type: 'REQUISITION_APPROVED', message: `Requisition ${rec.requisitionNo} approved`, actorId: req.user.sub } } } });
    await this.audit.log(companyId, req.user.sub, 'APPROVE', 'RecruitmentRequisition', id, { status: 'APPROVED' });
    return updated;
  }

  async rejectRequisition(req: any, id: string, reason: string) {
    const companyId = this.companyOf(req);
    const rec = await this.prisma.recruitmentRequisition.findFirst({ where: { id, companyId } });
    if (!rec) throw new BadRequestException('Requisition not found');
    if (rec.status === 'DRAFT' || rec.status === 'CANCELLED' || rec.status === 'FILLED') throw new BadRequestException('Cannot reject requisition in current state');
    const updated = await this.prisma.recruitmentRequisition.update({ where: { id }, data: { status: 'REJECTED', rejectedReason: reason, activities: { create: { companyId, type: 'REQUISITION_REJECTED', message: `Requisition ${rec.requisitionNo} rejected`, actorId: req.user.sub, metadata: { reason } } } } });
    await this.audit.log(companyId, req.user.sub, 'REJECT', 'RecruitmentRequisition', id, { status: 'REJECTED', reason });
    return updated;
  }

  // ---------- Applications / stage ----------
  async moveStage(req: any, applicationId: string, toStage: string, comment?: string) {
    const companyId = this.companyOf(req);
    const app = await this.prisma.jobApplication.findFirst({ where: { id: applicationId, companyId }, include: { candidate: true, vacancy: true } });
    if (!app) throw new BadRequestException('Application not found');
    if (!PIPELINE_STAGES.includes(toStage)) throw new BadRequestException('Invalid stage');
    const resStatus = toStage === 'HIRED' ? 'HIRED' : toStage === 'REJECTED' ? 'REJECTED' : app.status;
    await this.prisma.$transaction(async (tx) => {
      await tx.applicationStageHistory.create({ data: { companyId, applicationId, fromStage: app.stage, toStage, actorId: req.user.sub, comment } });
      await tx.jobApplication.update({ where: { id: applicationId }, data: { stage: toStage, status: resStatus } });
      await tx.recruitmentActivity.create({ data: { companyId, applicationId, type: 'APPLICATION_STAGE_CHANGED', message: `Stage → ${toStage}`, actorId: req.user.sub } });
    });
    if (toStage === 'HIRED') await this.markVacancyFilled(companyId, app.vacancyId);
    if (toStage === 'REJECTED') await this.audit.log(companyId, req.user.sub, 'REJECT', 'Application', applicationId, { toStage });
    else await this.audit.log(companyId, req.user.sub, 'MOVE', 'Application', applicationId, { fromStage: app.stage, toStage });
    return this.prisma.jobApplication.findUnique({ where: { id: applicationId }, include: { candidate: true, vacancy: true, stageHistory: { orderBy: { at: 'asc' } } } });
  }

  private async markVacancyFilled(companyId: string, vacancyId: string) {
    const v = await this.prisma.jobVacancy.findFirst({ where: { id: vacancyId, companyId } });
    if (!v) return;
    const hired = await this.prisma.jobApplication.count({ where: { vacancyId, stage: 'HIRED' } });
    if (hired >= v.openings) await this.prisma.jobVacancy.updateMany({ where: { id: vacancyId, companyId }, data: { status: 'FILLED' } });
  }

  // ---------- Offer workflow ----------
  async createOffer(req: any, dto: any) {
    const companyId = this.companyOf(req);
    const app = await this.prisma.jobApplication.findFirst({ where: { id: dto.applicationId, companyId }, include: { candidate: true, vacancy: true, offer: true } });
    if (!app) throw new BadRequestException('Application not found');
    if (app.offer) throw new BadRequestException('An offer already exists for this application');
    const no = dto.offerNo || await this.numbering.next(companyId, 'OFF');
    const offer = await this.prisma.offer.create({
      data: {
        companyId, offerNo: no, applicationId: app.id, candidateId: app.candidateId, position: dto.position || app.vacancy?.title,
        departmentId: dto.departmentId || app.vacancy?.departmentId, managerId: dto.managerId || app.vacancy?.hiringManagerId,
        baseSalary: dto.baseSalary || 0, currency: dto.currency || 'USD', payFrequency: dto.payFrequency || app.vacancy?.payFrequency || 'MONTHLY',
        employmentType: dto.employmentType || app.vacancy?.employmentType || 'FULL_TIME', startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        probationPeriod: dto.probationPeriod || 0, bonusPlan: dto.bonusPlan, benefits: dto.benefits, workLocation: dto.workLocation,
        workingHours: dto.workingHours, expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined, conditions: dto.conditions, notes: dto.notes, status: 'DRAFT',
      },
    });
    await this.audit.log(companyId, req.user.sub, 'CREATE', 'Offer', offer.id, { offerNo: no });
    return offer;
  }

  async submitOfferApproval(req: any, id: string) {
    const companyId = this.companyOf(req);
    const offer = await this.prisma.offer.findFirst({ where: { id, companyId } });
    if (!offer) throw new BadRequestException('Offer not found');
    if (offer.status !== 'DRAFT') throw new BadRequestException('Only DRAFT offers can be submitted for approval');
    const updated = await this.prisma.offer.update({ where: { id }, data: { status: 'PENDING_APPROVAL' } });
    await this.audit.log(companyId, req.user.sub, 'SUBMIT', 'Offer', id, { status: 'PENDING_APPROVAL' });
    return updated;
  }

  async approveOffer(req: any, id: string) {
    const companyId = this.companyOf(req);
    const offer = await this.prisma.offer.findFirst({ where: { id, companyId } });
    if (!offer) throw new BadRequestException('Offer not found');
    if (offer.status !== 'PENDING_APPROVAL') throw new BadRequestException('Offer is not awaiting approval');
    const updated = await this.prisma.offer.update({ where: { id }, data: { status: 'APPROVED', approvedAt: new Date(), approvedById: req.user.sub } });
    await this.audit.log(companyId, req.user.sub, 'APPROVE', 'Offer', id, { status: 'APPROVED' });
    return updated;
  }

  async sendOffer(req: any, id: string) {
    const companyId = this.companyOf(req);
    const offer = await this.prisma.offer.findFirst({ where: { id, companyId }, include: { application: { include: { candidate: true } } } });
    if (!offer) throw new BadRequestException('Offer not found');
    if (!['APPROVED', 'DRAFT'].includes(offer.status)) throw new BadRequestException('Offer must be approved before sending');
    const updated = await this.prisma.offer.update({ where: { id }, data: { status: 'SENT', sentAt: new Date() } });
    await this.audit.log(companyId, req.user.sub, 'SEND', 'Offer', id, { status: 'SENT' });
    return updated;
  }

  async acceptOffer(req: any, id: string) {
    const companyId = this.companyOf(req);
    const offer = await this.prisma.offer.findFirst({ where: { id, companyId }, include: { application: true } });
    if (!offer) throw new BadRequestException('Offer not found');
    if (!['SENT', 'VIEWED', 'APPROVED'].includes(offer.status)) throw new BadRequestException('Offer is not in a sendable state');
    const updated = await this.prisma.offer.update({ where: { id }, data: { status: 'ACCEPTED', acceptedAt: new Date() } });
    if (offer.applicationId) await this.prisma.jobApplication.updateMany({ where: { id: offer.applicationId, companyId }, data: { stage: 'OFFER', status: 'ACTIVE' } });
    await this.audit.log(companyId, req.user.sub, 'ACCEPT', 'Offer', id, { status: 'ACCEPTED' });
    return updated;
  }

  async declineOffer(req: any, id: string, reason?: string) {
    const companyId = this.companyOf(req);
    const offer = await this.prisma.offer.findFirst({ where: { id, companyId } });
    if (!offer) throw new BadRequestException('Offer not found');
    const updated = await this.prisma.offer.update({ where: { id }, data: { status: 'DECLINED', declinedReason: reason } });
    await this.audit.log(companyId, req.user.sub, 'DECLINE', 'Offer', id, { status: 'DECLINED', reason });
    return updated;
  }

  async withdrawOffer(req: any, id: string) {
    const companyId = this.companyOf(req);
    const offer = await this.prisma.offer.findFirst({ where: { id, companyId } });
    if (!offer) throw new BadRequestException('Offer not found');
    const updated = await this.prisma.offer.update({ where: { id }, data: { status: 'WITHDRAWN', withdrawnAt: new Date() } });
    await this.audit.log(companyId, req.user.sub, 'WITHDRAW', 'Offer', id, { status: 'WITHDRAWN' });
    return updated;
  }

  // ---------- Hire / conversion ----------
  async hireCandidate(req: any, applicationId: string, dto: any) {
    const companyId = this.companyOf(req);
    const app = await this.prisma.jobApplication.findFirst({
      where: { id: applicationId, companyId },
      include: { candidate: true, vacancy: true, offer: true },
    });
    if (!app) throw new BadRequestException('Application not found');
    if (app.stage === 'HIRED' && app.candidate?.employeeId) throw new BadRequestException('Candidate is already hired');
    if (app.offer && !['ACCEPTED', 'APPROVED', 'SENT', 'VIEWED'].includes(app.offer.status)) throw new BadRequestException('Offer must be accepted before hiring');

    const offer = app.offer;
    const empNo = await this.numbering.next(companyId, 'EMP');
    const firstName = app.candidate.firstName || (app.candidate.name || '').split(' ')[0];
    const lastName = app.candidate.lastName || (app.candidate.name || '').split(' ').slice(1).join(' ');

    const startDate = dto.startDate ? new Date(dto.startDate) : offer?.startDate || new Date();
    const salary = dto.basicSalary != null ? Number(dto.basicSalary) : Number(offer?.baseSalary ?? 0);

    const employee = await this.prisma.$transaction(async (tx) => {
      const emp = await tx.employee.create({
        data: {
          companyId, employeeNo: empNo, firstName: firstName || app.candidate.name, lastName: lastName || '',
          email: app.candidate.email, hireDate: startDate, basicSalary: salary,
          currency: dto.currency || offer?.currency || 'USD', position: dto.position || offer?.position || app.vacancy?.title,
          departmentId: dto.departmentId || offer?.departmentId || app.vacancy?.departmentId,
          managerId: dto.managerId || offer?.managerId || app.vacancy?.hiringManagerId,
          contractType: dto.contractType || offer?.employmentType, status: 'ACTIVE', active: true,
          bankDetails: dto.bankDetails as any, taxDetails: dto.taxDetails as any,
        },
      });
      await tx.candidate.update({ where: { id: app.candidateId }, data: { employeeId: emp.id, status: 'HIRED' } });
      await tx.jobApplication.update({ where: { id: applicationId }, data: { stage: 'HIRED', status: 'HIRED' } });
      await tx.applicationStageHistory.create({ data: { companyId, applicationId, fromStage: app.stage, toStage: 'HIRED', actorId: req.user.sub, comment: 'Hired' } });
      if (offer) await tx.offer.update({ where: { id: offer.id }, data: { status: 'ACCEPTED', acceptedAt: new Date() } });
      await tx.recruitmentActivity.create({ data: { companyId, applicationId, candidateId: app.candidateId, type: 'CANDIDATE_HIRED', message: `Converted to employee ${empNo}`, actorId: req.user.sub } });
      return emp;
    });
    await this.markVacancyFilled(companyId, app.vacancyId);
    await this.audit.log(companyId, req.user.sub, 'HIRE', 'Candidate', app.candidateId, { applicationId, employeeNo: empNo });
    return this.prisma.employee.findUnique({ where: { id: employee.id }, include: { department: true } });
  }
}
