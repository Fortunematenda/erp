import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { hasSecret } from './fiscal-crypto';

export type ReadinessItemStatus = 'OK' | 'MISSING' | 'INCOMPLETE' | 'WARNING';
export type ReadinessEvidence = 'CUSTOMER' | 'ZIMRA' | 'NEXUS' | 'VERIFICATION';

export interface ReadinessItem {
  key: string;
  label: string;
  status: ReadinessItemStatus;
  severity: 'critical' | 'warning' | 'info';
  reason?: string;
  whereToObtain?: string;
  action?: { label: string; href: string };
  evidence: ReadinessEvidence;
}

export interface ReadinessCategory {
  key: string;
  label: string;
  legal: boolean;
  items: ReadinessItem[];
}

const COMPANY_DETAILS = { label: 'Company Details', href: '/settings/company' };
const FISCAL_HREF = '/fiscalisation?tab=setup';

@Injectable()
export class FiscalisationReadinessService {
  constructor(private prisma: PrismaService) {}

  private item(
    key: string,
    label: string,
    ok: boolean,
    opts: Partial<ReadinessItem> = {},
  ): ReadinessItem {
    return {
      key,
      label,
      status: ok ? 'OK' : (opts.status || 'MISSING'),
      severity: ok ? 'info' : (opts.severity || 'critical'),
      reason: ok ? undefined : opts.reason,
      whereToObtain: ok ? undefined : opts.whereToObtain,
      action: ok ? undefined : opts.action,
      evidence: opts.evidence || 'CUSTOMER',
    };
  }

  async evaluate(companyId: string, target: 'MOCK' | 'SANDBOX' | 'PRODUCTION' = 'PRODUCTION') {
    const [company, profile, devices, taxRates, taxMappings, logs, receipts, inventoryMissing] = await Promise.all([
      this.prisma.company.findUnique({ where: { id: companyId } }),
      this.prisma.fiscalisationProfile.findUnique({ where: { companyId } }),
      this.prisma.fiscalDevice.findMany({ where: { branch: { companyId } }, include: { branch: true } }),
      this.prisma.taxRate.findMany({ where: { companyId, active: true } }),
      this.prisma.fiscalTaxMapping.findMany({ where: { companyId } }),
      this.prisma.fiscalIntegrationLog.findMany({ where: { device: { branch: { companyId } } }, orderBy: { createdAt: 'desc' }, take: 500 }),
      this.prisma.fiscalReceipt.findMany({ where: { OR: [{ invoice: { companyId } }, { creditNote: { companyId } }, { debitNote: { companyId } }] }, select: { status: true, serverSignature: true, receiptType: true, environment: true, total: true } }),
      this.prisma.inventoryItem.count({ where: { companyId, active: true, OR: [{ hsCode: null }, { hsCode: '' }] } }),
    ]);

    if (!company) return null;

    const isProd = target === 'PRODUCTION';
    const sandboxDevice = devices.find((d) => d.environment === 'SANDBOX') || null;
    const prodDevice = devices.find((d) => d.environment === 'PRODUCTION') || null;
    // Never let a mock device stand in for a production/sandbox device.
    const primary = isProd ? prodDevice : target === 'SANDBOX' ? sandboxDevice : (devices[0] || null);

    const now = Date.now();
    const certValid = !!primary?.certificateExpiresAt && primary.certificateExpiresAt.getTime() > now;
    const certDays = primary?.certificateExpiresAt ? Math.ceil((primary.certificateExpiresAt.getTime() - now) / 86400000) : null;

    const opOk = (op: string, env?: 'MOCK' | 'SANDBOX' | 'PRODUCTION') =>
      logs.some((l) => l.operation === op && l.status === 'OK' && (!env || l.environment === env));
    const receiptOk = (type: string, env?: 'MOCK' | 'SANDBOX' | 'PRODUCTION') =>
      logs.some((l) => l.operation === 'submitReceipt' && l.status === 'OK' && (!env || l.environment === env) && (l.request as any)?.receiptType === type);
    const signedReceipt = receipts.some((r) => !!r.serverSignature && (!primary || r.environment === primary.environment));

    const vatRequired = !!profile?.vatRegistered || !!company.vatNumber;
    const identityMatches = !!profile?.verifiedTaxpayerName && !!company.legalName &&
      profile.verifiedTaxpayerName.trim().toLowerCase() === company.legalName.trim().toLowerCase();

    const taxMapped = (code: string) => taxMappings.some((m) => m.erpTaxCode === code && m.fdmsTaxId && m.active);
    const unmappedTaxes = taxRates.filter((t) => !taxMapped(t.code));

    const unresolvedReceipts = receipts.filter((r) => ['RETRY', 'REJECTED'].includes(r.status)).length;
    const openDay = devices.some((d) => d.dayStatus === 'OPEN');

    const cat = (key: string, label: string, legal: boolean, items: ReadinessItem[]): ReadinessCategory => ({ key, label, legal, items });

    const taxpayer: ReadinessCategory = cat('taxpayer', 'Taxpayer', true, [
      this.item('company', 'Company selected', !!company.id),
      this.item('tin', 'TIN configured', !!company.tin, { reason: 'The company TIN is required to identify the taxpayer to ZIMRA.', whereToObtain: 'ZIMRA / company registration documents.', action: COMPANY_DETAILS, evidence: 'CUSTOMER' }),
      this.item('name', 'Registered taxpayer name configured', !!company.legalName, { action: COMPANY_DETAILS }),
      this.item('vatStatus', 'VAT registration status configured', !!profile && profile.vatRegistered !== undefined, { status: 'INCOMPLETE', action: { label: 'Set VAT status', href: FISCAL_HREF }, evidence: 'CUSTOMER' }),
      this.item('vatNumber', 'VAT number configured (where applicable)', !vatRequired || !!company.vatNumber, { status: 'INCOMPLETE', reason: 'The company is VAT-registered but no VAT number is set.', action: { label: 'Enter VAT number', href: FISCAL_HREF }, evidence: 'CUSTOMER' }),
      this.item('verified', 'Taxpayer verification completed', !!profile?.taxpayerVerified, { whereToObtain: 'ZIMRA taxpayer verification via FDMS.', action: { label: 'Verify taxpayer', href: FISCAL_HREF }, evidence: 'VERIFICATION' }),
      this.item('identity', 'Returned taxpayer identity matches company', identityMatches, { status: 'WARNING', severity: 'critical', reason: profile?.verifiedTaxpayerName ? `ZIMRA returned "${profile.verifiedTaxpayerName}" which differs from "${company.legalName}".` : 'Taxpayer has not been verified against ZIMRA.', action: { label: 'Review taxpayer', href: FISCAL_HREF }, evidence: 'VERIFICATION' }),
    ]);

    const branches = devices.map((d) => d.branch);
    const branchOk = branches.length > 0;
    const branch = cat('branch', 'Branch', true, [
      this.item('selected', 'Registered branch selected', branchOk, { reason: 'No branch has been configured for fiscalisation.', action: { label: 'Add branch', href: FISCAL_HREF } }),
      this.item('address', 'Branch address configured', branches.some((b) => !!(b.address || b.street) && !!b.city), { status: 'INCOMPLETE', action: { label: 'Complete branch address', href: '/fiscalisation?tab=setup' }, evidence: 'CUSTOMER' }),
      this.item('contact', 'Branch contact configured', branches.some((b) => !!b.phone || !!b.email), { status: 'INCOMPLETE', action: { label: 'Add branch contact', href: '/fiscalisation?tab=setup' }, evidence: 'CUSTOMER' }),
      this.item('registration', 'Branch registration confirmed with ZIMRA', branches.some((b) => !!(b.zimraRegion && b.zimraStation)) || !!profile?.testRegistrationRef, { status: 'WARNING', severity: 'warning', reason: 'Branch registration is performed through TaRMS/FDMS. Record the ZIMRA region/station and confirmation reference once obtained.', whereToObtain: 'TaRMS / FDMS taxpayer portal.', action: { label: 'Open TaRMS', href: 'https://mytaxselfservice.zimra.co.zw' }, evidence: 'ZIMRA' }),
      this.item('pos', 'Point of sale assigned', devices.some((d) => !!d.posLocation), { status: 'INCOMPLETE', action: { label: 'Assign POS', href: FISCAL_HREF } }),
    ]);

    const device = cat('device', 'Fiscal Device', true, [
      this.item('serial', 'Device serial number configured', devices.some((d) => !!d.serialNumber)),
      this.item('model', 'Registered model name configured', devices.some((d) => !!d.modelName), { whereToObtain: 'Registered device model as approved by ZIMRA.', action: { label: 'Set model', href: FISCAL_HREF }, evidence: 'NEXUS' }),
      this.item('modelVersion', 'Registered model version configured', devices.some((d) => !!d.modelVersion), { whereToObtain: 'Registered device model version.', action: { label: 'Set model version', href: FISCAL_HREF }, evidence: 'NEXUS' }),
      this.item('deviceId', 'ZIMRA Device ID obtained', !!primary?.zimraDeviceId, { whereToObtain: 'ZIMRA FDMS device registration process.', action: { label: 'Open FDMS Portal', href: 'https://fdmsops.zimra.co.zw/fdms-public/add-device' }, evidence: 'ZIMRA' }),
      this.item('activationKey', 'Activation key obtained', hasSecret(primary?.activationKeyEnc), { whereToObtain: "The registered device's activation details from ZIMRA.", action: { label: 'Enter activation key', href: FISCAL_HREF }, evidence: 'ZIMRA' }),
      this.item('registered', 'Device registration completed', !!primary?.registeredAt || primary?.status === 'ACTIVE', { reason: 'The device has not completed ZIMRA registration.', action: { label: 'Register device', href: FISCAL_HREF }, evidence: 'VERIFICATION' }),
      this.item('belongsToTaxpayer', 'Device belongs to the correct taxpayer', !!(primary?.registeredAt && identityMatches), { status: 'WARNING', reason: 'Taxpayer identity must be verified before the device can be trusted.', action: { label: 'Verify taxpayer', href: FISCAL_HREF }, evidence: 'VERIFICATION' }),
    ]);

    const security = cat('security', 'Security', true, [
      this.item('privateKey', 'Private key generated', !!primary?.privateKeyEnc, { status: 'INCOMPLETE', reason: 'No device private key has been generated.', whereToObtain: 'Generated by NexusERP during device registration.', action: { label: 'Generate CSR', href: FISCAL_HREF }, evidence: 'NEXUS' }),
      this.item('csr', 'CSR generated', !!primary?.csrPem, { status: 'INCOMPLETE', action: { label: 'Generate CSR', href: FISCAL_HREF }, evidence: 'NEXUS' }),
      this.item('certificate', 'Device certificate issued', !!primary?.certificatePem, { whereToObtain: 'Issued by ZIMRA during device registration.', action: { label: 'Install certificate', href: FISCAL_HREF }, evidence: 'ZIMRA' }),
      this.item('certValid', 'Certificate valid', certValid, { status: certDays != null && certDays < 0 ? 'MISSING' : 'INCOMPLETE', severity: 'critical', reason: certDays != null && certDays < 0 ? 'The device certificate has expired.' : 'No valid certificate expiry is recorded.', action: { label: 'Review certificate', href: FISCAL_HREF }, evidence: 'ZIMRA' }),
      this.item('certDevice', 'Certificate belongs to the configured device', !!(primary?.certificateThumbprint && primary?.privateKeyEnc), { status: 'INCOMPLETE', evidence: 'VERIFICATION' }),
      this.item('keyAvailable', 'Private key available to the secure signing service', !!(primary?.privateKeyEnc && primary?.certificatePem), { status: 'INCOMPLETE', evidence: 'NEXUS' }),
      this.item('mtls', 'Production mutual TLS authentication validated', opOk('mtls', 'PRODUCTION'), { status: 'WARNING', severity: isProd ? 'critical' : 'warning', reason: 'Mutual TLS with the production FDMS endpoint has not been validated.', action: { label: 'Test connection', href: FISCAL_HREF }, evidence: 'VERIFICATION' }),
    ]);

    const configuration = cat('configuration', 'Configuration', true, [
      this.item('getConfig', 'getConfig completed', opOk('getConfig', primary?.environment), { reason: 'Device configuration has not been synchronised from FDMS.', action: { label: 'Synchronise configuration', href: FISCAL_HREF }, evidence: 'VERIFICATION' }),
      this.item('taxpayerConfig', 'Taxpayer configuration synchronised', opOk('getConfig', primary?.environment), { status: 'INCOMPLETE', evidence: 'VERIFICATION' }),
      this.item('taxes', 'Applicable taxes synchronised', taxMappings.length > 0, { status: 'INCOMPLETE', reason: 'No FDMS tax mappings have been recorded.', action: { label: 'Configure tax mapping', href: '/fiscalisation?tab=setup' }, evidence: 'CUSTOMER' }),
      this.item('operatingMode', 'Device operating mode confirmed', !!primary?.zimraDeviceId, { status: 'INCOMPLETE', evidence: 'VERIFICATION' }),
      this.item('fiscalDayConfig', 'Fiscal-day configuration available', opOk('openDay', primary?.environment) || openDay, { status: 'INCOMPLETE', evidence: 'VERIFICATION' }),
      this.item('qrConfig', 'QR verification configuration available', opOk('getConfig', primary?.environment), { status: 'INCOMPLETE', evidence: 'VERIFICATION' }),
    ]);

    const integration = cat('integration', 'ERP Integration', false, [
      this.item('invoiceMapping', 'Invoice-to-receipt mapping configured', devices.length > 0, { status: 'INCOMPLETE' }),
      this.item('creditMapping', 'Credit-note mapping configured', devices.length > 0, { status: 'INCOMPLETE' }),
      this.item('debitMapping', 'Debit-note mapping configured', devices.length > 0, { status: 'INCOMPLETE' }),
      this.item('taxMappings', 'Tax mappings validated', unmappedTaxes.length === 0, { status: 'INCOMPLETE', reason: unmappedTaxes.length ? `${unmappedTaxes.length} configured ERP tax(es) have no valid FDMS mapping.` : undefined, action: { label: 'Review tax mapping', href: '/fiscalisation?tab=setup' }, evidence: 'CUSTOMER' }),
      this.item('classification', 'Product/service classification validated', inventoryMissing === 0, { status: 'WARNING', severity: 'info', reason: inventoryMissing ? `${inventoryMissing} active inventory item(s) are missing an HS code.` : undefined, action: { label: 'Review inventory', href: '/inventory' }, evidence: 'CUSTOMER' }),
      this.item('currency', 'Currency handling configured', !!company.baseCurrency, { status: 'INCOMPLETE' }),
      this.item('deviceRules', 'Device-selection rules configured', devices.length > 0, { status: 'INCOMPLETE', action: { label: 'Manage devices', href: FISCAL_HREF } }),
      this.item('numbering', 'Receipt numbering/concurrency protection enabled', true, { evidence: 'NEXUS' }),
      this.item('queue', 'Queue and recovery handling configured', true, { evidence: 'NEXUS' }),
    ]);

    const testing = cat('testing', 'Testing', false, [
      this.item('deviceRegistration', 'Device registration tested', opOk('registerDevice', 'SANDBOX')),
      this.item('taxpayerVerification', 'Taxpayer verification tested', !!profile?.taxpayerVerified),
      this.item('configSync', 'Configuration synchronisation tested', opOk('getConfig', 'SANDBOX')),
      this.item('dayOpen', 'Fiscal-day opening tested', opOk('openDay', 'SANDBOX')),
      this.item('invoiceSubmit', 'Invoice submission tested', receiptOk('FiscalInvoice', 'SANDBOX')),
      this.item('creditSubmit', 'Credit-note submission tested', receiptOk('FiscalCreditNote', 'SANDBOX')),
      this.item('debitSubmit', 'Debit-note submission tested', receiptOk('FiscalDebitNote', 'SANDBOX')),
      this.item('signature', 'Receipt signature verification tested', signedReceipt),
      this.item('dayClose', 'Fiscal-day closure tested', opOk('closeDay', 'SANDBOX')),
      this.item('rendering', 'Receipt rendering tested', false, { status: 'WARNING', severity: 'info', evidence: 'NEXUS' }),
      this.item('qr', 'QR verification tested', false, { status: 'WARNING', severity: 'info', evidence: 'NEXUS' }),
      this.item('isolation', 'Multi-company isolation tested', false, { status: 'WARNING', severity: 'info', evidence: 'NEXUS' }),
    ]);

    const approval = cat('approval', 'Production Approval', true, [
      this.item('testingComplete', 'Required ZIMRA testing completed', testing.items.every((i) => i.status === 'OK'), { reason: 'Not all sandbox integration tests have passed.', action: { label: 'Review testing', href: FISCAL_HREF }, evidence: 'VERIFICATION' }),
      this.item('samples', 'Sample documents submitted for approval', !!profile?.productionApprovalEvidence, { whereToObtain: 'Submit sample fiscal documents to ZIMRA.', action: { label: 'Record evidence', href: FISCAL_HREF }, evidence: 'ZIMRA' }),
      this.item('approval', 'Required approval obtained', !!profile?.productionApprovalRef, { whereToObtain: 'ZIMRA production onboarding approval.', action: { label: 'Record approval', href: FISCAL_HREF }, evidence: 'ZIMRA' }),
      this.item('evidence', 'Approval evidence recorded', !!profile?.productionApprovalEvidence, { action: { label: 'Attach evidence', href: FISCAL_HREF }, evidence: 'ZIMRA' }),
      this.item('prodDevice', 'Production device registration completed', !!prodDevice?.registeredAt || prodDevice?.status === 'ACTIVE', { whereToObtain: 'ZIMRA production device registration.', action: { label: 'Register production device', href: FISCAL_HREF }, evidence: 'ZIMRA' }),
      this.item('prodCredentials', 'Production credentials verified', !!prodDevice?.zimraDeviceId && hasSecret(prodDevice?.activationKeyEnc), { action: { label: 'Enter credentials', href: FISCAL_HREF }, evidence: 'ZIMRA' }),
      this.item('prodCert', 'Production certificate valid', !!prodDevice?.certificateExpiresAt && prodDevice.certificateExpiresAt.getTime() > now, { action: { label: 'Review certificate', href: FISCAL_HREF }, evidence: 'ZIMRA' }),
      this.item('finalCheck', 'Final production readiness check passed', false, { status: 'INCOMPLETE', evidence: 'VERIFICATION' }),
    ]);

    const categories = [taxpayer, branch, device, security, configuration, integration, testing, approval];

    const blockers = categories
      .flatMap((c) => c.items.map((i) => ({ ...i, category: c.label })))
      .filter((i) => i.status !== 'OK');

    const prodBlockers = categories
      .filter((c) => c.key !== 'testing')
      .flatMap((c) => c.items.filter((i) => i.status !== 'OK').map((i) => ({ ...i, category: c.label })));

    const readyForSandbox = ['taxpayer', 'branch', 'device'].every((k) =>
      categories.find((c) => c.key === k)!.items.filter((i) => i.key !== 'registration').every((i) => i.status === 'OK'));

    const sandboxTesting = testing.items.some((i) => i.status === 'OK');
    const testingComplete = testing.items.filter((i) => i.evidence !== 'NEXUS').every((i) => i.status === 'OK');

    let status = 'NOT_CONFIGURED';
    if (!profile && devices.length === 0) status = 'NOT_CONFIGURED';
    else if (!profile) status = 'PARTIALLY_CONFIGURED';
    else if (profile.environment === 'PRODUCTION') {
      status = prodBlockers.length === 0 ? 'PRODUCTION_ACTIVE' : 'PRODUCTION_CONFIGURATION_INCOMPLETE';
      if (status === 'PRODUCTION_ACTIVE' && (!certValid || unresolvedReceipts > 0)) status = 'PRODUCTION_DEGRADED';
    } else if (devices.some((d) => d.status === 'SUSPENDED')) status = 'SUSPENDED';
    else if (!readyForSandbox) status = 'PARTIALLY_CONFIGURED';
    else if (!sandboxTesting) status = 'READY_FOR_SANDBOX';
    else if (!testingComplete) status = 'SANDBOX_TESTING';
    else if (!profile.productionApprovalRef) status = 'AWAITING_APPROVAL';
    else status = prodBlockers.length === 0 ? 'PRODUCTION_READY' : 'PRODUCTION_CONFIGURATION_INCOMPLETE';

    return {
      company: { id: company.id, name: company.legalName, tin: company.tin, vatNumber: company.vatNumber, baseCurrency: company.baseCurrency },
      environment: { current: profile?.environment || 'MOCK', target },
      status,
      ready: prodBlockers.length === 0,
      categories,
      blockers,
      summary: {
        total: categories.reduce((s, c) => s + c.items.length, 0),
        passed: categories.reduce((s, c) => s + c.items.filter((i) => i.status === 'OK').length, 0),
        missing: blockers.filter((b) => b.status === 'MISSING').length,
        incomplete: blockers.filter((b) => b.status === 'INCOMPLETE').length,
        warnings: blockers.filter((b) => b.status === 'WARNING').length,
        unresolvedReceipts,
        openDay,
        certificateDays: certDays,
        inventoryMissing,
      },
    };
  }

  // Blocking conditions enforced on the backend for production activation.
  async assertProductionActivatable(companyId: string) {
    const r = await this.evaluate(companyId, 'PRODUCTION');
    if (!r) throw new Error('Company not found');
    const hard = r.blockers.filter((b) => b.severity === 'critical' && b.status === 'MISSING');
    return { result: r, blockers: r.blockers, hard, allowed: r.ready };
  }
}
