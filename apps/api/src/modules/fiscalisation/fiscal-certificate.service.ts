import { BadRequestException, Injectable } from '@nestjs/common';
import { createPrivateKey, createPublicKey, X509Certificate } from 'crypto';
import * as forge from 'node-forge';

// Device cryptographic material for ZIMRA FDMS. Private keys are generated
// server-side, stored encrypted at rest (see fiscal-crypto) and never returned
// to the client. The CSR is submitted to ZIMRA during device registration; the
// issued device certificate is validated against the stored private key before
// it is trusted.
@Injectable()
export class FiscalCertificateService {
  generateKeyAndCsr(params: { commonName: string; organisation?: string; country?: string; serialNumber?: string }) {
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const csr = forge.pki.createCertificationRequest();
    csr.publicKey = keys.publicKey;
    csr.setSubject([
      { name: 'commonName', value: params.commonName },
      ...(params.organisation ? [{ name: 'organizationName', value: params.organisation }] : []),
      ...(params.country ? [{ name: 'countryName', value: params.country }] : []),
      ...(params.serialNumber ? [{ name: 'serialNumber', value: params.serialNumber }] : []),
    ]);
    csr.sign(keys.privateKey, forge.md.sha256.create());
    return {
      privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
      csrPem: forge.pki.certificationRequestToPem(csr),
      publicKeyPem: forge.pki.publicKeyToPem(keys.publicKey),
    };
  }

  thumbprint(pem: string): string {
    try {
      return new X509Certificate(pem).fingerprint256.replace(/:/g, '').toUpperCase();
    } catch {
      return '';
    }
  }

  certificateMatchesKey(certPem: string, privateKeyPem: string): boolean {
    try {
      const certKey = new X509Certificate(certPem).publicKey.export({ type: 'spki', format: 'der' });
      const privKey = createPublicKey(createPrivateKey(privateKeyPem)).export({ type: 'spki', format: 'der' });
      return Buffer.compare(certKey as Buffer, privKey as Buffer) === 0;
    } catch {
      return false;
    }
  }

  validateCertificate(certPem: string, privateKeyPem: string) {
    if (!certPem || !/-----BEGIN CERTIFICATE-----/.test(certPem)) {
      throw new BadRequestException('A valid PEM certificate is required.');
    }
    const cert = new X509Certificate(certPem);
    const expiresAt = new Date(cert.validTo);
    const issuedAt = new Date(cert.validFrom);
    if (expiresAt.getTime() < Date.now()) throw new BadRequestException('The supplied certificate has already expired.');
    if (!this.certificateMatchesKey(certPem, privateKeyPem)) {
      throw new BadRequestException('The supplied certificate does not match the device private key.');
    }
    return { certificatePem: certPem, certificateThumbprint: this.thumbprint(certPem), certificateExpiresAt: expiresAt, certificateIssuedAt: issuedAt };
  }
}
