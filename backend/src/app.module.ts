import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from './config/config.module.js';
import { AppConfigService } from './config/config.service.js';
import { ClockModule } from './infra/clock/clock.module.js';
import { PrismaModule } from './infra/prisma/prisma.module.js';
import { MailerModule } from './infra/mailer/mailer.module.js';
import { GstinApiModule } from './infra/gstinapi/gstinapi.module.js';
import { RazorpayModule } from './infra/razorpay/razorpay.module.js';
import { BbpsModule } from './infra/bbps/bbps.module.js';
import { SmsModule } from './infra/sms/sms.module.js';
import { SecurityModule } from './infra/security/security.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { JobBlogModule } from './modules/job-blog/job-blog.module.js';
import { VendorsModule } from './modules/vendors/vendors.module.js';
import { PricingModule } from './modules/pricing/pricing.module.js';
import { KycModule } from './modules/kyc/kyc.module.js';
import { PollsModule } from './modules/polls/polls.module.js';
import { LedgerModule } from './modules/ledger/ledger.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { BulkBuyModule } from './modules/bulk-buy/bulk-buy.module.js';
import { PocketTransfersModule } from './modules/pocket-transfers/pocket-transfers.module.js';
import { TreasuryModule } from './modules/treasury/treasury.module.js';
import { ServiceRequestsModule } from './modules/service-requests/service-requests.module.js';
import { MaintenanceModule } from './modules/maintenance/maintenance.module.js';
import { BankStatementsModule } from './modules/bank-statements/bank-statements.module.js';
import { OperatorModule } from './modules/operator/operator.module.js';
import { VirtualAccountsModule } from './modules/virtual-accounts/virtual-accounts.module.js';
import { SocietyModule } from './modules/society/society.module.js';
import { DelegationModule } from './modules/delegation/delegation.module.js';
import { ConsentModule } from './modules/consent/consent.module.js';
import { DashboardModule } from './modules/dashboard/dashboard.module.js';
import { BillsModule } from './modules/bills/bills.module.js';
import { HomeModule } from './modules/home/home.module.js';
import { TariffModule } from './modules/electricity/tariff.module.js';
import { WaterModule } from './modules/water/water.module.js';
import { RealtimeModule } from './modules/realtime/realtime.module.js';
import { MetersModule } from './modules/electricity/meters/meters.module.js';
import { ReadingsModule } from './modules/electricity/readings/readings.module.js';
import { HealthCampsModule } from './modules/health-camps/health-camps.module.js';
import { DonationsModule } from './modules/donations/donations.module.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { AuditLogInterceptor } from './common/interceptors/audit-log.interceptor.js';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        pinoHttp: {
          level: config.env.LOG_LEVEL,
          transport: config.isProduction ? undefined : { target: 'pino-pretty', options: { singleLine: true } },
          autoLogging: true,
          redact: ['req.headers.cookie', 'req.headers.authorization'],
        },
      }),
    }),
    ClockModule,
    PrismaModule,
    MailerModule,
    GstinApiModule,
    RazorpayModule,
    BbpsModule,
    SmsModule,
    SecurityModule,
    AuditModule,
    NotificationsModule,
    AuthModule,
    UsersModule,
    JobBlogModule,
    VendorsModule,
    PricingModule,
    KycModule,
    PollsModule,
    LedgerModule,
    PaymentsModule,
    BulkBuyModule,
    PocketTransfersModule,
    TreasuryModule,
    ServiceRequestsModule,
    MaintenanceModule,
    BankStatementsModule,
    OperatorModule,
    VirtualAccountsModule,
    SocietyModule,
    DelegationModule,
    ConsentModule,
    DashboardModule,
    BillsModule,
    HomeModule,
    TariffModule,
    WaterModule,
    RealtimeModule,
    MetersModule,
    ReadingsModule,
    HealthModule,
    HealthCampsModule,
    DonationsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
  ],
})
export class AppModule {}
