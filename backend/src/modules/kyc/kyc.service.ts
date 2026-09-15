import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import type { KycDocumentModel } from '../../generated/prisma/models.js';
import type { UploadKycDocumentDto } from './dto/upload-kyc-document.dto.js';

/**
 * Phase-2 stub: records upload metadata only — no real file handling. A
 * later phase wires this up to an actual object store and sets a real
 * storageRef; for now it's a fake local path so downstream code has a
 * stable field to reference.
 */
@Injectable()
export class KycService {
  constructor(private readonly prisma: PrismaService) {}

  async recordUpload(userId: string, dto: UploadKycDocumentDto): Promise<KycDocumentModel> {
    return this.prisma.kycDocument.create({
      data: {
        userId,
        kind: dto.kind,
        fileName: dto.fileName,
        storageRef: `local://kyc/${randomUUID()}`,
      },
    });
  }
}
