import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { CurrentUserContext } from '../../common/types/current-user.js';
import type { KycDocumentModel } from '../../generated/prisma/models.js';
import { UploadKycDocumentDto } from './dto/upload-kyc-document.dto.js';
import { KycService } from './kyc.service.js';

/** Phase-2 stub controller — see KycService for scope notes. */
@Controller('kyc')
export class KycController {
  constructor(private readonly kycService: KycService) {}

  @Post('documents')
  @UseGuards(AuthGuard)
  async uploadDocument(@CurrentUser() currentUser: CurrentUserContext, @Body() dto: UploadKycDocumentDto): Promise<KycDocumentModel> {
    return this.kycService.recordUpload(currentUser.id, dto);
  }
}
