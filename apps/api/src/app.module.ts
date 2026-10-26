import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthGuard } from './common/auth/auth.guard.js';
import { AuthorizationModule } from './common/auth/authorization.module.js';
import { OriginGuard } from './common/auth/origin.guard.js';
import { PermissionGuard } from './common/auth/permission.guard.js';
import { LoggerModule } from 'nestjs-pino';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { redactUrl } from './common/logging/redact-url.js';
import { APP_CONFIG, AppConfigModule } from './config/config.module.js';
import type { Env } from './config/env.js';
import { ActivityModule } from './infrastructure/activity/activity.module.js';
import { MailModule } from './infrastructure/mail/mail.module.js';
import { PrismaModule } from './infrastructure/prisma/prisma.module.js';
import { TenancyModule } from './infrastructure/tenancy/tenancy.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { AttendanceModule } from './modules/attendance/attendance.module.js';
import { CalendarModule } from './modules/calendar/calendar.module.js';
import { GoalsModule } from './modules/goals/goals.module.js';
import { ReviewsModule } from './modules/reviews/reviews.module.js';
import { SkillsModule } from './modules/skills/skills.module.js';
import { FeedbackModule } from './modules/feedback/feedback.module.js';
import { OneOnOnesModule } from './modules/one-on-ones/one-on-ones.module.js';
import { CapacityModule } from './modules/capacity/capacity.module.js';
import { ProjectsModule } from './modules/projects/projects.module.js';
import { TimeModule } from './modules/time/time.module.js';
import { PrivacyModule } from './modules/privacy/privacy.module.js';
import { LeaveModule } from './modules/leave/leave.module.js';
import { OrganizationModule } from './modules/organization/organization.module.js';
import { EmployeesModule } from './modules/employees/employees.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { RolesModule } from './modules/roles/roles.module.js';
import { TenantsModule } from './modules/tenants/tenants.module.js';
import { UsersModule } from './modules/users/users.module.js';

const REQUEST_ID_PATTERN = /^[\w-]{8,64}$/;

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
          // Accept a well-formed id from a proxy/client, otherwise generate one; always echo it back.
          genReqId: (req, res) => {
            const incoming = req.headers['x-request-id'];
            const id =
              typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming)
                ? incoming
                : randomUUID();
            res.setHeader('x-request-id', id);
            return id;
          },
          // One-time links and OAuth codes travel in query strings; mask them in logged URLs.
          serializers: {
            // The parsed query would repeat the URL's values unredacted, so it is left out.
            req: ({ query, ...req }: { url?: string; query?: unknown }) => ({
              ...req,
              url: req.url ? redactUrl(req.url) : req.url,
            }),
          },
          // GDPR: never log credentials or cookies.
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
              'req.body.password',
            ],
            censor: '[redacted]',
          },
        },
      }),
    }),
    PrismaModule,
    TenancyModule,
    MailModule,
    ActivityModule,
    // Per-route limits are set with @Throttle on the auth endpoints; in memory (one instance).
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    HealthModule,
    RolesModule,
    AuditModule,
    NotificationsModule,
    AuthorizationModule,
    AuthModule,
    TenantsModule,
    UsersModule,
    EmployeesModule,
    OrganizationModule,
    LeaveModule,
    AttendanceModule,
    CalendarModule,
    PrivacyModule,
    ProjectsModule,
    TimeModule,
    CapacityModule,
    GoalsModule,
    OneOnOnesModule,
    FeedbackModule,
    SkillsModule,
    ReviewsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Order matters: reject foreign-origin writes before doing any authentication work.
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    // After sign-in is checked: does the route's declared permission match the user's grants?
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class AppModule {}
