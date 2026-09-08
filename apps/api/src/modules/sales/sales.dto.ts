import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsEmail, IsIn, IsNumber, IsOptional, IsString, Max, Min, ValidateIf, ValidateNested } from 'class-validator';

export class InvoiceLineDto {
  @IsString() description!: string;
  @IsOptional() @IsString() itemId?: string;
  @Type(() => Number) @IsNumber() @Min(0.0001, { message: 'Quantity must be greater than 0' }) quantity!: number;
  @Type(() => Number) @IsNumber() @Min(0, { message: 'Rate must be greater than or equal to 0' }) unitPrice!: number;
  @Type(() => Number) @IsNumber() @Min(0) @Max(100) taxRate!: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) discount?: number;
  @IsOptional() @IsString() hsCode?: string;
  @IsOptional() @IsString() unit?: string;
}

export class CreateInvoiceDto {
  @IsString() branchId!: string;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() invoiceNo?: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsBoolean() fiscalRequired?: boolean;
  @IsOptional() @IsString() dueDate?: string;
  @IsOptional() @IsString() invoiceDate?: string;
  @IsOptional() @IsString() terms?: string;
  @IsOptional() @IsString() billingAddress?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() statementMemo?: string;
  @IsOptional() @ValidateIf((_, v) => v != null && String(v).trim() !== '') @IsEmail({}, { message: 'Invalid email' }) @IsString() email?: string;
  @IsOptional() @IsString() customerReference?: string;
  @IsOptional() @IsString() poReference?: string;
  @IsOptional() @IsString() salesperson?: string;
  @IsOptional() @IsString() projectId?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => InvoiceLineDto) lines!: InvoiceLineDto[];
}

export class UpdateInvoiceDto {
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() invoiceNo?: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsBoolean() fiscalRequired?: boolean;
  @IsOptional() @IsString() dueDate?: string;
  @IsOptional() @IsString() invoiceDate?: string;
  @IsOptional() @IsString() terms?: string;
  @IsOptional() @IsString() billingAddress?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() statementMemo?: string;
  @IsOptional() @ValidateIf((_, v) => v != null && String(v).trim() !== '') @IsEmail({}, { message: 'Invalid email' }) @IsString() email?: string;
  @IsOptional() @IsString() customerReference?: string;
  @IsOptional() @IsString() poReference?: string;
  @IsOptional() @IsString() salesperson?: string;
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => InvoiceLineDto) lines?: InvoiceLineDto[];
}

export class DocLineDto {
  @IsString() description!: string;
  @IsOptional() @IsString() itemId?: string;
  @Type(() => Number) @IsNumber() @Min(0.0001, { message: 'Quantity must be greater than 0' }) quantity!: number;
  @Type(() => Number) @IsNumber() @Min(0, { message: 'Rate must be greater than or equal to 0' }) unitPrice!: number;
  @Type(() => Number) @IsNumber() @Min(0) @Max(100) taxRate!: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) discount?: number;
  @IsOptional() @IsString() unit?: string;
}

export class CreateQuotationDto {
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() statementMemo?: string;
  @IsOptional() @IsString() validUntil?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() currency?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => DocLineDto) lines!: DocLineDto[];
}

export class CreateSalesOrderDto {
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() quotationId?: string;
  @IsOptional() @IsString() dueDate?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() warehouseId?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => DocLineDto) lines!: DocLineDto[];
}

export class CreateReceiptDto {
  @IsOptional() @IsString() invoiceId?: string;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() receiptDate?: string;
  @Type(() => Number) @IsNumber() @Min(0.01) amount!: number;
  @IsOptional() @IsString() method?: string;
  @IsOptional() @IsString() referenceNo?: string;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsString() depositAccountId?: string;
  @IsOptional() @IsString() idempotencyKey?: string;
  @IsOptional() @IsArray() allocations?: any[];
}

export class CreateCreditNoteDto {
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() invoiceId?: string;
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() creditNoteDate?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => DocLineDto) lines!: DocLineDto[];
}

export class CustomerDto {
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsString() companyName?: string;
  @IsOptional() @ValidateIf((_, v) => v != null && String(v).trim() !== '') @IsEmail({}, { message: 'Invalid email' }) @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() mobile?: string;
  @IsOptional() @IsString() address1?: string;
  @IsOptional() @IsString() address2?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() zip?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() paymentTerms?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() taxStatus?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100) defaultTaxRate?: number;
  @IsOptional() @IsString() tin?: string;
  @IsOptional() @IsString() vatNumber?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) creditLimit?: number;
  @IsOptional() @IsString() priceListId?: string;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: string;
}

export class StatusDto {
  @IsString() status!: string;
}
