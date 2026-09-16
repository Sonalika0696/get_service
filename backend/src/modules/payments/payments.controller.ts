import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { PrincipalGuard } from '../../common/guards/principal.guard.js';
import { ResidentOnly } from '../../common/decorators/principal.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentResident } from '../../common/decorators/current-user.decorator.js';
import { AuditLog } from '../../common/decorators/audit-log.decorator.js';
import type { ResidentPrincipal } from '../../common/types/current-user.js';
import { RoleKind } from '../../generated/prisma/enums.js';
import type { PaymentModel } from '../../generated/prisma/models.js';
import { RazorpayService } from '../../infra/razorpay/razorpay.service.js';
import { CreateOrderDto } from './dto/create-order.dto.js';
import { PaymentsService, type CreateOrderResult, type RefundInitiatedResult, type RazorpayWebhookEvent } from './payments.service.js';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly razorpay: RazorpayService,
  ) {}

  @Post('orders')
  @UseGuards(AuthGuard, PrincipalGuard)
  @ResidentOnly()
  async createOrder(@CurrentResident() currentUser: ResidentPrincipal, @Body() dto: CreateOrderDto, @Headers('idempotency-key') idempotencyKey?: string): Promise<CreateOrderResult> {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    return this.paymentsService.createOrder(currentUser.societyId, currentUser.id, idempotencyKey, dto);
  }

  /**
   * PUBLIC — Razorpay calls this server-to-server, so it deliberately carries
   * no AuthGuard. Every byte of trust here comes from
   * verifyWebhookSignature, checked against req.rawBody (the exact bytes
   * Razorpay signed) BEFORE the payload is parsed or acted on in any way.
   * See main.ts (`rawBody: true`) for how req.rawBody gets populated.
   */
  @Post('webhook')
  @HttpCode(200)
  async webhook(@Req() req: RawBodyRequest<Request>, @Headers('x-razorpay-signature') signature?: string): Promise<{ received: boolean }> {
    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new BadRequestException('Missing raw request body');
    }
    if (!this.razorpay.verifyWebhookSignature(rawBody, signature)) {
      throw new BadRequestException('Invalid signature');
    }

    let event: RazorpayWebhookEvent;
    try {
      event = JSON.parse(rawBody.toString('utf8')) as RazorpayWebhookEvent;
    } catch {
      throw new BadRequestException('Malformed JSON body');
    }

    return this.paymentsService.handleWebhook(event);
  }

  /**
   * Treasurer-only: initiates a Razorpay refund. Does not itself change
   * Payment.status or post to the ledger — see PaymentsService.refund's doc
   * comment. In stub mode (RAZORPAY_ENABLED=false) there is no real
   * Razorpay to deliver the follow-up webhook, so completing the flow in
   * dev/tests means POSTing a signed `refund.processed` webhook yourself
   * (see test/payments.e2e-spec.ts).
   */
  @Post(':id/refund')
  @UseGuards(AuthGuard, PrincipalGuard, RolesGuard)
  @ResidentOnly()
  @Roles(RoleKind.TREASURER)
  @AuditLog('PAYMENT_REFUND', 'Payment')
  async refund(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<RefundInitiatedResult> {
    return this.paymentsService.refund(currentUser.societyId, id);
  }

  /** Society-scoped read: any authenticated member of the payment's own society may read it (cross-society lookups 404, matching VendorsService's pattern). */
  @Get(':id')
  @UseGuards(AuthGuard, PrincipalGuard)
  @ResidentOnly()
  async get(@CurrentResident() currentUser: ResidentPrincipal, @Param('id') id: string): Promise<PaymentModel> {
    return this.paymentsService.get(currentUser.societyId, id);
  }
}
