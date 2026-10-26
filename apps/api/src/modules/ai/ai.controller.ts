import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  aiChatRequestSchema,
  aiConsentRequestSchema,
  aiKeyRequestSchema,
  aiWorkspaceRequestSchema,
  type AiChatRequest,
  type AiChatResponse,
  type AiConsentRequest,
  type AiConversation,
  type AiConversationList,
  type AiKeyRequest,
  type AiStatus,
  type AiWorkspaceRequest,
} from '@intime/contracts';
import type { RequestAuth } from '../../common/auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../../common/auth/decorators.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AiService } from './ai.service.js';

@ApiTags('ai')
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('status')
  @RequirePermission('ai.use')
  @ApiOperation({ summary: 'Switch, consent and keys (never the key itself)' })
  status(@CurrentAuth() actor: RequestAuth): Promise<AiStatus> {
    return this.ai.status(actor);
  }

  @Put('consent')
  @RequirePermission('ai.use')
  @ApiOperation({ summary: 'Accept the notice about sending data to an AI provider' })
  consent(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(aiConsentRequestSchema)) body: AiConsentRequest,
  ): Promise<AiStatus> {
    return this.ai.consent(actor, body);
  }

  @Put('workspace')
  @RequirePermission('ai.toggle_tenant')
  @ApiOperation({ summary: 'Switch the assistant on or off for the workspace; set the retention' })
  workspace(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(aiWorkspaceRequestSchema)) body: AiWorkspaceRequest,
  ): Promise<AiStatus> {
    return this.ai.workspace(actor, body);
  }

  @Put('key/me')
  @RequirePermission('ai.manage_own_key')
  @ApiOperation({ summary: 'Store your own provider key (encrypted; never returned)' })
  setOwnKey(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(aiKeyRequestSchema)) body: AiKeyRequest,
  ): Promise<AiStatus> {
    return this.ai.setKey(actor, 'user', body);
  }

  @Delete('key/me')
  @RequirePermission('ai.manage_own_key')
  removeOwnKey(@CurrentAuth() actor: RequestAuth): Promise<AiStatus> {
    return this.ai.removeKey(actor, 'user');
  }

  @Post('key/me/test')
  @HttpCode(200)
  @RequirePermission('ai.manage_own_key')
  testOwnKey(@CurrentAuth() actor: RequestAuth): Promise<{ ok: true }> {
    return this.ai.testKey(actor, 'user');
  }

  @Put('key/workspace')
  @RequirePermission('ai.manage_tenant_key')
  @ApiOperation({ summary: 'Store the workspace provider key (encrypted; never returned)' })
  setWorkspaceKey(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(aiKeyRequestSchema)) body: AiKeyRequest,
  ): Promise<AiStatus> {
    return this.ai.setKey(actor, 'workspace', body);
  }

  @Delete('key/workspace')
  @RequirePermission('ai.manage_tenant_key')
  removeWorkspaceKey(@CurrentAuth() actor: RequestAuth): Promise<AiStatus> {
    return this.ai.removeKey(actor, 'workspace');
  }

  @Post('key/workspace/test')
  @HttpCode(200)
  @RequirePermission('ai.manage_tenant_key')
  testWorkspaceKey(@CurrentAuth() actor: RequestAuth): Promise<{ ok: true }> {
    return this.ai.testKey(actor, 'workspace');
  }

  @Post('chat')
  @HttpCode(200)
  @RequirePermission('ai.use')
  @ApiOperation({ summary: 'Ask the assistant; it answers from what you may see' })
  chat(
    @CurrentAuth() actor: RequestAuth,
    @Body(new ZodValidationPipe(aiChatRequestSchema)) body: AiChatRequest,
  ): Promise<AiChatResponse> {
    return this.ai.chat(actor, body);
  }

  @Get('conversations')
  @RequirePermission('ai.use')
  conversations(@CurrentAuth() actor: RequestAuth): Promise<AiConversationList> {
    return this.ai.list(actor);
  }

  @Get('conversations/:id')
  @RequirePermission('ai.use')
  conversation(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AiConversation> {
    return this.ai.get(actor, id);
  }

  @Delete('conversations/:id')
  @HttpCode(204)
  @RequirePermission('ai.use')
  async remove(
    @CurrentAuth() actor: RequestAuth,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.ai.remove(actor, id);
  }
}
