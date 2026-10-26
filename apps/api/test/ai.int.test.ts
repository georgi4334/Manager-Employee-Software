import { randomBytes } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  AI_LIMITS,
  addDays,
  aiChatResponseSchema,
  aiConversationListSchema,
  aiConversationSchema,
  aiStatusSchema,
  apiErrorBodySchema,
  employeeSchema,
  todayIn,
  weekStartOf,
  type AiStatus,
  type SystemRole,
} from '@intime/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { APP_CONFIG } from '../src/config/config.module.js';
import type { Env } from '../src/config/env.js';
import { SystemPrismaService } from '../src/infrastructure/prisma/system-prisma.service.js';
import {
  AiProviderClient,
  type ProviderReply,
  type ProviderRequest,
} from '../src/modules/ai/ai-provider.client.js';
import { AppException } from '../src/common/errors/app-exception.js';
import { testDbUrls } from './db-urls.js';
import { createTestApp, testEnv } from './helpers.js';
import { httpWorkspaceHelpers, type Member, type Workspace } from './support/http-workspace.js';

const urls = testDbUrls();
const errorBody = (res: { body: unknown }) => apiErrorBodySchema.parse(res.body).error;
const UNKNOWN = '0192f5a0-0000-7000-8000-00000000000a';
const ZONE = 'Europe/Sofia';
const api = '/api/v1';
const KEY = 'gsk_live_ABCDEFGH-1234567890';
const OTHER_KEY = 'sk-or-ZZZZZZZZ-0987654321';

class FakeProvider extends AiProviderClient {
  calls: ProviderRequest[] = [];
  script: (request: ProviderRequest, n: number) => ProviderReply | Error = () => ({
    content: 'All good.',
    toolCalls: [],
  });
  async complete(request: ProviderRequest): Promise<ProviderReply> {
    this.calls.push(structuredClone(request));
    const result = this.script(request, this.calls.length);
    if (result instanceof Error) throw result;
    return result;
  }
}
const fake = new FakeProvider();
const text = (content: string): ProviderReply => ({ content, toolCalls: [] });
const callTool = (name: string, args = '{}', id = 'call_1'): ProviderReply => ({
  content: null,
  toolCalls: [{ id, name, arguments: args }],
});

describe.skipIf(!urls)('AI assistant over HTTP (real database, fake provider)', () => {
  const masterKey = randomBytes(32).toString('base64');
  const env = testEnv({
    DATABASE_URL: urls?.app,
    SYSTEM_DATABASE_URL: urls?.system,
    TRUST_PROXY: 'true',
    AI_KEY_ENCRYPTION_KEY: masterKey,
  });
  let app: NestExpressApplication;
  let system: SystemPrismaService;
  const { workspace, accept } = httpWorkspaceHelpers(() => app);

  type Person = Member & { employeeId: string };
  let acme: Workspace;
  let globex: Workspace;
  let hr: Person;
  let mia: Person; // manager of dan
  let dan: Person;
  let eve: Person;
  let rita: Person; // only for the hourly limit
  const today = todayIn(ZONE);
  const offDay = addDays(weekStartOf(today), 22); // a Tuesday three weeks ahead

  async function onboard(ws: Workspace, name: string, role: SystemRole = 'employee') {
    const email = `${name}@${ws === acme ? 'acme' : 'globex'}.eu`;
    const res = await ws.admin.agent
      .post(`${api}/employees`)
      .send({ firstName: name, lastName: 'Test', employmentType: 'full_time', email });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const who = await accept(email);
    if (role !== 'employee') {
      const set = await ws.admin.agent
        .put(`${api}/users/${who.id}/roles`)
        .send({ roleIds: [ws.roleIds[role]] });
      expect(set.status).toBe(200);
    }
    return { ...who, employeeId: employeeSchema.parse(res.body).id };
  }
  const status = async (who: Member): Promise<AiStatus> => {
    const res = await who.agent.get(`${api}/ai/status`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return aiStatusSchema.parse(res.body);
  };
  const putKey = (who: Member, scope: 'me' | 'workspace', body: object) =>
    who.agent.put(`${api}/ai/key/${scope}`).send(body);
  const keyBody = (apiKey = KEY, provider = 'groq') => ({
    provider,
    model: 'llama-3.3-70b-versatile',
    apiKey,
  });
  const chat = (who: Member, message: string, conversationId?: string) =>
    who.agent
      .post(`${api}/ai/chat`)
      .send({ message, ...(conversationId ? { conversationId } : {}) });
  const ok = async (who: Member, message: string, conversationId?: string) => {
    const res = await chat(who, message, conversationId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return aiChatResponseSchema.parse(res.body);
  };
  const consent = (who: Member, sharePeopleData = false) =>
    who.agent.put(`${api}/ai/consent`).send({ accept: true, sharePeopleData });

  beforeAll(async () => {
    app = await createTestApp({
      env,
      providers: [{ provide: AiProviderClient, useValue: fake }],
    });
    system = app.get(SystemPrismaService);
    acme = await workspace('acme');
    globex = await workspace('globex');
    await system.tenant.update({ where: { id: acme.tenantId }, data: { defaultTimezone: ZONE } });
    hr = await onboard(acme, 'hrx', 'hr');
    mia = await onboard(acme, 'mia', 'manager');
    dan = await onboard(acme, 'dan');
    eve = await onboard(acme, 'eve');
    rita = await onboard(acme, 'rita');
    const set = await acme.admin.agent
      .put(`${api}/org/employees/${dan.employeeId}/assignment`)
      .send({ managerId: mia.employeeId, departmentId: null });
    expect(set.status).toBe(204);

    // Dan has approved leave on `offDay`
    const types = (await dan.agent.get(`${api}/leave/types`)).body as { id: string; key: string }[];
    const leave = await dan.agent.post(`${api}/leave/requests`).send({
      leaveTypeId: types.find((t) => t.key === 'unpaid')!.id,
      startDate: offDay,
      endDate: offDay,
    });
    expect(leave.status, JSON.stringify(leave.body)).toBe(201);
    const approve = await hr.agent
      .post(`${api}/leave/requests/${(leave.body as { id: string }).id}/approve`)
      .send({});
    expect(approve.status, JSON.stringify(approve.body)).toBe(200);
  });
  afterAll(async () => {
    await system.tenant.deleteMany();
    await app.close();
  });
  beforeEach(() => {
    fake.calls = [];
    fake.script = () => text('All good.');
  });

  describe('switch, consent and keys', () => {
    it('starts switched off, without consent or keys', async () => {
      const s = await status(dan);
      expect(s).toMatchObject({
        enabled: false,
        canStoreKeys: true,
        retentionDays: AI_LIMITS.defaultRetentionDays,
        consent: { accepted: false, sharePeopleData: false },
        ownKey: null,
        workspaceKey: null,
        keySource: null,
      });
      expect(s.tools).not.toContain('who_is_off');
    });

    it('lets only a workspace administrator switch it on, validated and audited', async () => {
      const denied = await dan.agent.put(`${api}/ai/workspace`).send({ enabled: true });
      expect(denied.status).toBe(403);
      for (const body of [{}, { retentionDays: 0 }, { retentionDays: 400 }, { enabled: 'yes' }]) {
        const bad = await acme.admin.agent.put(`${api}/ai/workspace`).send(body);
        expect(bad.status, JSON.stringify(body)).toBe(400);
      }
      const res = await acme.admin.agent
        .put(`${api}/ai/workspace`)
        .send({ enabled: true, retentionDays: 30 });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(aiStatusSchema.parse(res.body)).toMatchObject({ enabled: true, retentionDays: 30 });
      const entries = await system.auditLog.findMany({
        where: { tenantId: acme.tenantId, action: 'ai.workspace_updated' },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]?.after).toEqual({ enabled: true, retentionDays: 30 });
      await acme.admin.agent.put(`${api}/ai/workspace`).send({ retentionDays: 90 });
    });

    it('stores a key encrypted, never returns it and audits scope and provider only', async () => {
      const res = await putKey(dan, 'me', keyBody());
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain(KEY);
      const s = aiStatusSchema.parse(res.body);
      expect(s.ownKey).toEqual({
        provider: 'groq',
        model: 'llama-3.3-70b-versatile',
        last4: '7890',
      });
      expect(s.keySource).toBe('user');
      expect(JSON.stringify(await status(dan))).not.toContain('ABCDEFGH');

      const row = await system.aiCredential.findFirst({
        where: { tenantId: acme.tenantId, userId: dan.id },
      });
      expect(row?.secretEnc).not.toContain('ABCDEFGH');
      expect(row?.secretEnc.split('.')).toHaveLength(3);
      const entries = await system.auditLog.findMany({
        where: { tenantId: acme.tenantId, action: 'ai.key_set' },
      });
      expect(JSON.stringify(entries)).not.toContain('ABCDEFGH');
      expect(entries.at(-1)?.after).toEqual({ scope: 'user', provider: 'groq' });
    });

    it('replaces an existing key instead of adding a second one', async () => {
      await putKey(dan, 'me', keyBody(OTHER_KEY, 'openrouter'));
      expect(
        await system.aiCredential.count({ where: { tenantId: acme.tenantId, userId: dan.id } }),
      ).toBe(1);
      const s = await status(dan);
      expect(s.ownKey).toMatchObject({ provider: 'openrouter', last4: '4321' });
      await putKey(dan, 'me', keyBody());
    });

    it.each([
      ['an unknown provider', { ...keyBody(), provider: 'evil' }],
      ['a short key', keyBody('short')],
      ['a key with a space', keyBody('abcd efgh ijkl')],
      ['a model that is a URL', { ...keyBody(), model: 'http://evil.example/x' }],
      ['no body', {}],
    ])('refuses %s', async (_name, body) => {
      const res = await putKey(eve, 'me', body);
      expect(res.status).toBe(400);
      expect(errorBody(res).code).toBe('VALIDATION_FAILED');
    });

    it('keeps the workspace key to people who manage it and below a personal key', async () => {
      const denied = await putKey(dan, 'workspace', keyBody());
      expect(denied.status).toBe(403);
      expect((await dan.agent.delete(`${api}/ai/key/workspace`)).status).toBe(403);
      expect((await dan.agent.post(`${api}/ai/key/workspace/test`)).status).toBe(403);

      const res = await putKey(acme.admin, 'workspace', keyBody(OTHER_KEY, 'mistral'));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(aiStatusSchema.parse(res.body).workspaceKey).toMatchObject({
        provider: 'mistral',
        last4: '4321',
      });
      // everybody else sees the effect, not the key
      const eves = await status(eve);
      expect(eves.workspaceKey).toBeNull();
      expect(eves.keySource).toBe('workspace');
      expect((await status(dan)).keySource).toBe('user');
      expect(JSON.stringify(await status(eve))).not.toContain('ZZZZZZZZ');
    });

    it('refuses to store keys when the server has no master key', async () => {
      const config = app.get<Env>(APP_CONFIG);
      const saved = config.AI_MASTER_KEY;
      config.AI_MASTER_KEY = null;
      try {
        const res = await putKey(eve, 'me', keyBody());
        expect(res.status).toBe(409);
        expect(errorBody(res).code).toBe('AI_NOT_CONFIGURED');
        expect((await status(eve)).canStoreKeys).toBe(false);
      } finally {
        config.AI_MASTER_KEY = saved;
      }
    });

    it('tests a stored key with the decrypted value and reports provider failures by class only', async () => {
      const res = await dan.agent.post(`${api}/ai/key/me/test`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(fake.calls[0]).toMatchObject({ provider: 'groq', apiKey: KEY, maxTokens: 5 });
      expect(fake.calls[0]?.tools).toBeUndefined();

      fake.script = () =>
        new AppException('AI_PROVIDER_ERROR', { params: { reason: 'rejected_key' } });
      const bad = await dan.agent.post(`${api}/ai/key/me/test`);
      expect(bad.status).toBe(502);
      expect(errorBody(bad)).toMatchObject({
        code: 'AI_PROVIDER_ERROR',
        params: { reason: 'rejected_key' },
      });

      const none = await eve.agent.post(`${api}/ai/key/me/test`);
      expect(none.status).toBe(409);
      expect(errorBody(none).code).toBe('AI_NOT_CONFIGURED');
    });

    it('does not decrypt a ciphertext that was moved to another person', async () => {
      await putKey(eve, 'me', keyBody(OTHER_KEY, 'openrouter'));
      const dans = await system.aiCredential.findFirstOrThrow({
        where: { tenantId: acme.tenantId, userId: dan.id },
      });
      await system.aiCredential.updateMany({
        where: { tenantId: acme.tenantId, userId: eve.id },
        data: { secretEnc: dans.secretEnc },
      });
      const res = await eve.agent.post(`${api}/ai/key/me/test`);
      expect(res.status).toBe(409);
      expect(errorBody(res).code).toBe('AI_NOT_CONFIGURED');
      expect(fake.calls).toHaveLength(0);
      // removing it again is allowed and idempotent
      expect((await eve.agent.delete(`${api}/ai/key/me`)).status).toBe(200);
      expect((await eve.agent.delete(`${api}/ai/key/me`)).status).toBe(200);
      expect((await status(eve)).ownKey).toBeNull();
    });

    it('needs an explicit acceptance of the notice', async () => {
      const bad = await eve.agent
        .put(`${api}/ai/consent`)
        .send({ accept: false, sharePeopleData: false });
      expect(bad.status).toBe(400);
      expect((await eve.agent.put(`${api}/ai/consent`).send({})).status).toBe(400);
    });
  });

  describe('the chat', () => {
    it('is refused while the workspace has it switched off', async () => {
      await acme.admin.agent.put(`${api}/ai/workspace`).send({ enabled: false });
      const res = await chat(dan, 'hello');
      expect(res.status).toBe(403);
      expect(errorBody(res).code).toBe('AI_DISABLED');
      expect(fake.calls).toHaveLength(0);
      await acme.admin.agent.put(`${api}/ai/workspace`).send({ enabled: true });
    });

    it('needs consent, then a key', async () => {
      const noConsent = await chat(dan, 'hello');
      expect(noConsent.status).toBe(403);
      expect(errorBody(noConsent).code).toBe('AI_CONSENT_REQUIRED');

      const accepted = await consent(eve);
      expect(accepted.status).toBe(200);
      expect(aiStatusSchema.parse(accepted.body).consent).toEqual({
        accepted: true,
        sharePeopleData: false,
      });
      await acme.admin.agent.delete(`${api}/ai/key/workspace`);
      const noKey = await chat(eve, 'hello');
      expect(noKey.status).toBe(409);
      expect(errorBody(noKey).code).toBe('AI_NOT_CONFIGURED');
      await putKey(acme.admin, 'workspace', keyBody(OTHER_KEY, 'mistral'));
      expect(fake.calls).toHaveLength(0);
    });

    it('asks again when the notice changed', async () => {
      await consent(rita);
      await system.aiUserSetting.updateMany({
        where: { tenantId: acme.tenantId, userId: rita.id },
        data: { consentVersion: 0 },
      });
      const res = await chat(rita, 'hello');
      expect(errorBody(res).code).toBe('AI_CONSENT_REQUIRED');
    });

    it('answers with the own key, offering only tools about the person asking', async () => {
      await consent(dan);
      fake.script = () => text('You have 20 days.');
      const reply = await ok(dan, 'How many days do I have left?');
      expect(reply.message).toMatchObject({
        role: 'assistant',
        content: 'You have 20 days.',
        toolsUsed: [],
      });
      const request = fake.calls[0]!;
      expect(request).toMatchObject({ provider: 'groq', apiKey: KEY });
      expect(request.tools?.map((t) => t.name).sort()).toEqual(
        ['get_my_goals', 'get_my_leave_balance', 'get_my_open_tasks'].sort(),
      );
      expect(request.messages[0]?.role).toBe('system');
      // no names or emails in the instructions
      const system0 = JSON.stringify(request.messages[0]);
      for (const secret of ['dan', 'mia', 'hrx', '@acme.eu']) expect(system0).not.toContain(secret);
      expect(request.messages.at(-1)).toEqual({
        role: 'user',
        content: 'How many days do I have left?',
      });
    });

    it('uses the workspace key when the person has none', async () => {
      await consent(eve);
      await ok(eve, 'hello');
      expect(fake.calls[0]).toMatchObject({ provider: 'mistral', apiKey: OTHER_KEY });
    });

    it('runs a tool as the person asking and feeds the result back', async () => {
      fake.script = (_request, n) =>
        n === 1 ? callTool('get_my_leave_balance') : text('20 days left.');
      const reply = await ok(dan, 'Leave?');
      expect(reply.message.toolsUsed).toEqual(['get_my_leave_balance']);
      expect(fake.calls).toHaveLength(2);
      const tool = fake.calls[1]!.messages.find((m) => m.role === 'tool')!;
      expect(tool).toMatchObject({ role: 'tool', toolCallId: 'call_1' });
      const data = JSON.parse(tool.content) as {
        balances: { type: string; remainingDays: number }[];
      };
      expect(data.balances.find((b) => b.type === 'annual')).toBeDefined();
      expect(tool.content).not.toContain(dan.employeeId);
    });

    it('does not run tools about other people until the person agreed to share such data', async () => {
      fake.script = (_request, n) =>
        n === 1 ? callTool('who_is_off', '{}', 'x') : text('Nobody.');
      const reply = await ok(dan, 'Who is off?');
      expect(reply.message.toolsUsed).toEqual([]);
      const tool = fake.calls[1]!.messages.find((m) => m.role === 'tool')!;
      expect(JSON.parse(tool.content)).toEqual({ error: 'unknown_tool' });
      fake.script = (_request, n) => (n === 1 ? callTool('drop_database') : text('no'));
      await ok(dan, 'Do something');
      expect(JSON.parse(fake.calls[1]!.messages.find((m) => m.role === 'tool')!.content)).toEqual({
        error: 'unknown_tool',
      });
    });

    it('offers the people tools after consent to share, and they respect the caller’s scope', async () => {
      await consent(mia, true);
      await consent(eve, true);
      const period = JSON.stringify({ from: offDay, to: offDay });
      fake.script = (_request, n) => (n === 1 ? callTool('who_is_off', period) : text('done'));
      const manager = await ok(mia, 'Who is off?');
      expect(manager.message.toolsUsed).toEqual(['who_is_off']);
      expect(fake.calls[0]?.tools?.map((t) => t.name)).toContain('find_available_people');
      const seen = JSON.parse(fake.calls[1]!.messages.find((m) => m.role === 'tool')!.content) as {
        people: { name: string }[];
      };
      expect(seen.people.map((p) => p.name)).toEqual(['dan Test']);

      fake.calls = [];
      await ok(eve, 'Who is off?'); // default script: no tool call, nothing to see
      fake.calls = [];
      fake.script = (_request, n) => (n === 1 ? callTool('who_is_off', period) : text('done'));
      await ok(eve, 'Who is off on that day?');
      const hers = JSON.parse(fake.calls[1]!.messages.find((m) => m.role === 'tool')!.content) as {
        people?: { name: string }[];
        error?: string;
      };
      expect(JSON.stringify(hers)).not.toContain('dan');
    });

    it('lists availability only for people the caller may see', async () => {
      fake.script = (_request, n) => (n === 1 ? callTool('find_available_people') : text('done'));
      await ok(eve, 'Who has time?');
      const result = JSON.parse(
        fake.calls[1]!.messages.find((m) => m.role === 'tool')!.content,
      ) as {
        people: { name: string }[];
      };
      expect(result.people.map((p) => p.name)).toEqual(['eve Test']);
    });

    it('rejects bad tool arguments without leaking details', async () => {
      fake.script = (_request, n) =>
        n === 1 ? callTool('who_is_off', '{"from":"not-a-date"}') : text('done');
      await ok(mia, 'Who is off?');
      const tool = fake.calls[1]!.messages.find((m) => m.role === 'tool')!;
      expect(JSON.parse(tool.content)).toEqual({ error: 'failed' });
      fake.calls = [];
      fake.script = (_request, n) => (n === 1 ? callTool('who_is_off', '{broken') : text('done'));
      await ok(mia, 'Who is off?');
      expect(JSON.parse(fake.calls[1]!.messages.find((m) => m.role === 'tool')!.content)).toEqual({
        error: 'invalid_arguments',
      });
    });

    it('stops after the maximum number of tool rounds and asks for a final answer without tools', async () => {
      fake.script = (request) => (request.tools ? callTool('get_my_goals') : text('Enough.'));
      const reply = await ok(dan, 'Loop');
      expect(reply.message.content).toBe('Enough.');
      expect(fake.calls).toHaveLength(AI_LIMITS.maxToolRounds + 1);
      expect(fake.calls.at(-1)?.tools).toBeUndefined();
    });

    it('keeps the conversation and sends the earlier turns along', async () => {
      fake.script = () => text('First answer.');
      const first = await ok(dan, 'First question');
      fake.script = () => text('Second answer.');
      await ok(dan, 'Second question', first.conversationId);
      const roles = fake.calls.at(-1)!.messages.map((m) => `${m.role}:${m.content}`);
      expect(roles.slice(1)).toEqual([
        'user:First question',
        'assistant:First answer.',
        'user:Second question',
      ]);
      const res = await dan.agent.get(`${api}/ai/conversations/${first.conversationId}`);
      const conversation = aiConversationSchema.parse(res.body);
      expect(conversation.title).toBe('First question');
      expect(conversation.messages.map((m) => m.role)).toEqual([
        'user',
        'assistant',
        'user',
        'assistant',
      ]);
    });

    it('reports a provider failure by class and keeps nothing but the question', async () => {
      fake.script = () =>
        new AppException('AI_PROVIDER_ERROR', {
          message: 'secret provider text',
          params: { reason: 'provider_down' },
        });
      const res = await chat(dan, 'Will fail');
      expect(res.status).toBe(502);
      expect(JSON.stringify(res.body)).not.toContain(
        'secret provider text'.replace('secret provider text', KEY),
      );
      expect(errorBody(res).params).toEqual({ reason: 'provider_down' });
    });

    it.each([
      ['empty', { message: '   ' }],
      ['too long', { message: 'x'.repeat(AI_LIMITS.maxMessageLength + 1) }],
      ['not a conversation id', { message: 'hi', conversationId: 'nope' }],
      ['missing', {}],
    ])('refuses a message that is %s', async (_name, body) => {
      const res = await dan.agent.post(`${api}/ai/chat`).send(body);
      expect(res.status).toBe(400);
      expect(fake.calls).toHaveLength(0);
    });

    it('limits the messages per hour', async () => {
      await consent(rita);
      await putKey(rita, 'me', keyBody());
      for (let i = 0; i < AI_LIMITS.messagesPerHour; i++) await ok(rita, `Question ${i}`);
      const res = await chat(rita, 'One too many');
      expect(res.status).toBe(429);
      expect(errorBody(res).code).toBe('RATE_LIMITED');
      expect(fake.calls).toHaveLength(AI_LIMITS.messagesPerHour);
      // other people are not affected
      await ok(dan, 'Still fine');
    });
  });

  describe('conversations belong to one person', () => {
    let conversationId: string;
    beforeAll(async () => {
      fake.script = () => text('Private answer.');
      conversationId = (await ok(dan, 'My private question')).conversationId;
    });

    it('lists only the own conversations', async () => {
      const mine = aiConversationListSchema.parse(
        (await dan.agent.get(`${api}/ai/conversations`)).body,
      );
      expect(mine.items.some((c) => c.id === conversationId)).toBe(true);
      for (const other of [eve, mia, hr, acme.admin, globex.admin]) {
        const res = await other.agent.get(`${api}/ai/conversations`);
        expect(res.status).toBe(200);
        expect(
          aiConversationListSchema.parse(res.body).items.some((c) => c.id === conversationId),
        ).toBe(false);
      }
    });

    it.each(['eve', 'mia', 'hr', 'admin', 'globexAdmin'])(
      'is 404 for %s: read, continue and delete',
      async (name) => {
        const who = { eve, mia, hr, admin: acme.admin, globexAdmin: globex.admin }[name]!;
        expect((await who.agent.get(`${api}/ai/conversations/${conversationId}`)).status).toBe(404);
        expect((await who.agent.delete(`${api}/ai/conversations/${conversationId}`)).status).toBe(
          404,
        );
        fake.calls = [];
        const res = await chat(who, 'sneaky', conversationId);
        expect([404, 403, 409]).toContain(res.status); // never 200
        expect(res.status).not.toBe(200);
        expect(JSON.stringify(res.body)).not.toContain('Private answer');
      },
    );

    it('is 404 for an unknown id and 400 for a malformed one', async () => {
      expect((await dan.agent.get(`${api}/ai/conversations/${UNKNOWN}`)).status).toBe(404);
      expect((await dan.agent.get(`${api}/ai/conversations/nope`)).status).toBe(400);
    });

    it('can be deleted by its owner, once', async () => {
      expect((await dan.agent.delete(`${api}/ai/conversations/${conversationId}`)).status).toBe(
        204,
      );
      expect((await dan.agent.delete(`${api}/ai/conversations/${conversationId}`)).status).toBe(
        404,
      );
      expect(await system.aiMessage.count({ where: { conversationId } })).toBe(0);
    });

    it('purges conversations older than the retention on the next chat', async () => {
      fake.script = () => text('Old answer.');
      const old = await ok(dan, 'An old question');
      await system.aiConversation.update({
        where: { id: old.conversationId },
        data: { updatedAt: new Date(Date.now() - 95 * 86_400_000) },
      });
      await ok(dan, 'A new question');
      expect((await dan.agent.get(`${api}/ai/conversations/${old.conversationId}`)).status).toBe(
        404,
      );
    });
  });

  describe('tenant isolation', () => {
    it("another workspace sees none of this workspace's settings, keys or conversations", async () => {
      const s = await status(globex.admin);
      expect(s).toMatchObject({
        enabled: false,
        ownKey: null,
        workspaceKey: null,
        keySource: null,
      });
      const res = await chat(globex.admin, 'hello');
      expect(errorBody(res).code).toBe('AI_DISABLED');
      expect(await system.aiConversation.count({ where: { tenantId: globex.tenantId } })).toBe(0);
      expect(await system.aiCredential.count({ where: { tenantId: globex.tenantId } })).toBe(0);
    });

    it('a key stored in one workspace is never used in another', async () => {
      await globex.admin.agent.put(`${api}/ai/workspace`).send({ enabled: true });
      await consent(globex.admin);
      const res = await chat(globex.admin, 'hello');
      expect(errorBody(res).code).toBe('AI_NOT_CONFIGURED');
      expect(fake.calls).toHaveLength(0);
    });
  });
});
