import { Global, Module } from '@nestjs/common';
import { PasswordService } from './password.service.js';
import { TotpService } from './totp.service.js';

@Global()
@Module({
  providers: [PasswordService, TotpService],
  exports: [PasswordService, TotpService],
})
export class SecurityModule {}
