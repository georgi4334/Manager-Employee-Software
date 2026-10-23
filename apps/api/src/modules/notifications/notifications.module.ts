import { Global, Module } from '@nestjs/common';
import { EmailDispatcher } from './delivery/email-dispatcher.service.js';
import { NotificationProcessor } from './delivery/notification-processor.service.js';
import { NotificationRetention } from './delivery/notification-retention.service.js';
import { OutboxWorker } from './delivery/outbox-worker.service.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { OutboxService } from './outbox.service.js';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    OutboxService,
    OutboxWorker,
    NotificationProcessor,
    EmailDispatcher,
    NotificationRetention,
  ],
  exports: [OutboxService, OutboxWorker],
})
export class NotificationsModule {}
