import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { PrincipalGuard } from '../../common/guards/principal.guard.js';
import { OperatorOnly } from '../../common/decorators/principal.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { CurrentUserContext } from '../../common/types/current-user.js';
import type { UserModel } from '../../generated/prisma/models.js';
import { ProvisionAccountDto } from './dto/provision-account.dto.js';
import { AccountsService } from './accounts.service.js';

@Controller('operator/accounts')
@UseGuards(AuthGuard, PrincipalGuard)
@OperatorOnly()
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  /** No `@AuditLog(...)` — AccountsService.provision writes its own (best-effort) entry when a society is resolvable; see its doc comment for the OPERATOR-kind gap. */
  @Post()
  async provision(@CurrentUser() operator: CurrentUserContext, @Body() dto: ProvisionAccountDto): Promise<UserModel> {
    return this.accountsService.provision(operator.id, dto);
  }
}
