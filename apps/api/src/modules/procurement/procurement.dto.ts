import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';

export class ReqLineDto {
  @IsString() description!: string;
  @IsOptional() @IsString() itemId?: string;
  @Type(() => Number) @IsNumber() quantity!: number;
  @Type(() => Number) @IsNumber() unitPrice!: number;
  @IsOptional() @Type(() => Number) @IsNumber() discount?: number;
  @IsOptional() @Type(() => Number) @IsNumber() taxRate?: number;
  @IsOptional() @IsString() accountId?: string;
  @IsOptional() @IsString() accountCode?: string;
}

export class CreateRequisitionDto {
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() requestedBy?: string;
  @IsOptional() @IsString() dateRequired?: string;
  @IsOptional() @IsString() notes?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => ReqLineDto) lines!: ReqLineDto[];
}

export class CreatePurchaseOrderDto {
  @IsString() supplierId!: string;
  @IsOptional() @IsString() orderDate?: string;
  @IsOptional() @IsString() expectedDate?: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() paymentTerms?: string;
  @IsOptional() @IsString() supplierReference?: string;
  @IsOptional() @IsString() shipTo?: string;
  @IsOptional() @IsString() memo?: string;
  @IsOptional() @IsString() requisitionId?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => ReqLineDto) lines!: ReqLineDto[];
}

export class CreateGrnDto {
  @IsOptional() @IsString() purchaseOrderId?: string;
  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsString() warehouseId?: string;
  @IsOptional() @IsString() reference?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => ReqLineDto) lines!: ReqLineDto[];
}

export class CreateSupplierInvoiceDto {
  @IsOptional() @IsString() purchaseOrderId?: string;
  @IsString() supplierId!: string;
  @IsOptional() @IsString() invoiceNo?: string;
  @IsOptional() @IsString() invoiceDate?: string;
  @IsOptional() @IsString() dueDate?: string;
  @IsOptional() @IsString() terms?: string;
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() ref?: string;
  @IsOptional() @IsString() memo?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => ReqLineDto) lines!: ReqLineDto[];
}

export class PaymentAllocationDto {
  @IsString() supplierInvoiceId!: string;
  @Type(() => Number) @IsNumber() amount!: number;
}

export class CreateSupplierPaymentDto {
  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsString() supplierInvoiceId?: string;
  @IsOptional() @IsString() purchaseOrderId?: string;
  @IsOptional() @IsString() paidAt?: string;
  @Type(() => Number) @IsNumber() amount!: number;
  @IsOptional() @IsString() method?: string;
  @IsOptional() @IsString() referenceNo?: string;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsString() payFromAccountId?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PaymentAllocationDto) allocations?: PaymentAllocationDto[];
}

export class SupplierDto {
  @IsOptional() @IsString() code?: string;
  @IsString() name!: string;
  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsString() companyName?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() mobile?: string;
  @IsOptional() @IsString() website?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() vendorType?: string;
  @IsOptional() @IsString() contactName?: string;
  @IsOptional() @IsString() jobTitle?: string;
  @IsOptional() @IsString() address1?: string;
  @IsOptional() @IsString() address2?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() zip?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() tin?: string;
  @IsOptional() @IsBoolean() vatRegistered?: boolean;
  @IsOptional() @IsString() vatNumber?: string;
  @IsOptional() @IsString() withholdingTaxType?: string;
  @IsOptional() @Type(() => Number) @IsNumber() withholdingTaxRate?: number;
  @IsOptional() @IsString() companyRegNo?: string;
  @IsOptional() @IsString() paymentTerms?: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() paymentMethod?: string;
  @IsOptional() @Type(() => Number) @IsNumber() leadTimeDays?: number;
  @IsOptional() @Type(() => Number) @IsNumber() minimumOrderValue?: number;
  @IsOptional() @IsString() defaultBuyer?: string;
  @IsOptional() @IsString() defaultBranchId?: string;
  @IsOptional() @IsString() defaultWarehouseId?: string;
  @IsOptional() @IsString() defaultProjectId?: string;
  @IsOptional() @IsString() defaultExpenseCategory?: string;
  @IsOptional() @IsString() accountNumber?: string;
  @IsOptional() @Type(() => Number) @IsNumber() openingBalance?: number;
  @IsOptional() @Type(() => Number) @IsNumber() creditLimit?: number;
  @IsOptional() @IsBoolean() preferred?: boolean;
  @IsOptional() @Type(() => Number) @IsNumber() rating?: number;
  @IsOptional() @IsString() complianceStatus?: string;
  @IsOptional() @IsString() contractStart?: string;
  @IsOptional() @IsString() contractEnd?: string;
  @IsOptional() @IsString() bankName?: string;
  @IsOptional() @IsString() bankAccountName?: string;
  @IsOptional() @IsString() bankBranch?: string;
  @IsOptional() @IsString() bankCode?: string;
  @IsOptional() @IsString() swift?: string;
  @IsOptional() @IsString() iban?: string;
  @IsOptional() @IsString() mobileMoneyProvider?: string;
  @IsOptional() @IsString() mobileMoneyNumber?: string;
  @IsOptional() @IsString() notes?: string;
}
