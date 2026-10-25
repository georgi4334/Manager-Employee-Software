import { Global, Module } from '@nestjs/common';
import { EmailDispatcher } from './delivery/email-dispatcher.service.js';
import { NotificationProcessor } from './delivery/notification-processor.service.js';
import { NotificationRetention } from './delivery/notification-retention.service.js';
import { RemindersService } from './delivery/reminders.service.js';
import { OutboxWorker } from './delivery/outbox-worker.service.js';
import { NotificationsController } from './notifications.controller.js';
import { RemindersController } from './reminders.controller.js';
import { NotificationsService } from './notifications.service.js';
import { OutboxService } from './outbox.service.js';

@Global()
@Module({
  controllers: [NotificationsController, RemindersController],
  providers: [
    NotificationsService,
    OutboxService,
    OutboxWorker,
    NotificationProcessor,
    EmailDispatcher,
    NotificationRetention,
    RemindersService,
  ],
  exports: [OutboxService, OutboxWorker],
})
export class NotificationsModule {}
