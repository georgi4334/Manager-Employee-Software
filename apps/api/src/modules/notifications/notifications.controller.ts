import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  notificationQuerySchema,
  updateNotificationPreferenceSchema,
  type NotificationList,
  type NotificationPreference,
  type NotificationQuery,
  type UpdateNotificationPreference,
} from '@intime/contracts';
import { z } from 'zod';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { Authenticated, CurrentAuth, RequirePermission } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { NotificationsService } from './notifications.service.js';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @Authenticated()
  @ApiOperation({ summary: 'My notifications, newest first' })
  list(
    @CurrentAuth() actor: RequestAuth,
    @Query(new ZodValidationPipe(notificationQuerySchema)) query: NotificationQuery,
  ): Promise<NotificationList> {
    return this.notifications.list(actor, query);
  }

  @Get('unread-count')
  @Authenticated()
  @ApiOperation({ summary: 'How many unread notifications I have (cheap; polled by the bell)' })
  async unreadCount(@CurrentAuth() actor: RequestAuth): Promise<{ unreadCount: number }> {
    return { unreadCount: await this.notifications.unreadCount(actor) };
  }

  @Post('read-all')
  @HttpCode(200)
  @Authenticated()
  @ApiOperation({ summary: 'Mark all my notifications as read' })
  readAll(@CurrentAuth() actor: RequestAuth): Promise<{ updated: number }> {
    return this.notifications.markAllRead(actor);
  }

  @Get('preferences')
  @RequirePermission('notification.manage_own_prefs')
  @ApiOperation({ summary: 'My notification preferences per type and channel' })
  preferences(@CurrentAuth() actor: RequestAuth): Promise<NotificationPreference[]> {
    return this.notifications.listPreferences(actor);
  }

  @Put('preferences')
  @RequirePermission('notification.manage_own_prefs')
  @ApiOperation({ summary: 'Switch one channel of one notification type on or off' })
  updatePreference(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(updateNotificationPreferenceSchema))
    body: UpdateNotificationPreference,
  ): Promise<NotificationPreference> {
    return this.notifications.updatePreference(actor, body);
  }

  @Post(':id/read')
  @HttpCode(204)
  @Authenticated()
  @ApiOperation({ summary: 'Mark one notification as read' })
  async read(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', new ZodValidationPipe(z.uuid())) id: string,
  ): Promise<void> {
    await this.notifications.markRead(actor, id);
  }
}
