import { z } from 'zod';

export const FEEDBACK_KINDS = ['praise', 'constructive'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
/** `recipient`: only the person. `recipient_and_manager`: also their manager and HR. */
export const FEEDBACK_VISIBILITIES = ['recipient', 'recipient_and_manager'] as const;
export type FeedbackVisibility = (typeof FEEDBACK_VISIBILITIES)[number];
export const FEEDBACK_BOXES = ['received', 'given', 'reported'] as const;
export type FeedbackBox = (typeof FEEDBACK_BOXES)[number];

export const MAX_FEEDBACK_BODY = 2000;

/** The state of a report on an item, from what is stored. */
export type FeedbackReportState = 'none' | 'open' | 'kept';
export const feedbackReportState = (item: {
  reportedAt: unknown | null;
  keptAt: unknown | null;
}): FeedbackReportState => (item.keptAt ? 'kept' : item.reportedAt ? 'open' : 'none');

// ----- requests --------------------------------------------------------------------------------

export const createFeedbackRequestSchema = z
  .object({
    toEmployeeId: z.uuid(),
    kind: z.enum(FEEDBACK_KINDS),
    visibility: z.enum(FEEDBACK_VISIBILITIES).default('recipient'),
    body: z
      .string()
      .trim()
      .min(1, { error: 'required' })
      .max(MAX_FEEDBACK_BODY, { error: 'tooLong' }),
  })
  .strict();
export type CreateFeedbackRequest = z.infer<typeof createFeedbackRequestSchema>;

export const feedbackQuerySchema = z.object({
  box: z.enum(FEEDBACK_BOXES).default('received'),
  /** Received feedback of this person (what was shared with their manager); omitted = yourself. */
  employeeId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type FeedbackQuery = z.infer<typeof feedbackQuerySchema>;

// ----- responses -------------------------------------------------------------------------------

const person = z.object({ id: z.uuid(), firstName: z.string(), lastName: z.string() });

export const feedbackItemSchema = z.object({
  id: z.uuid(),
  from: person,
  to: person,
  kind: z.enum(FEEDBACK_KINDS),
  visibility: z.enum(FEEDBACK_VISIBILITIES),
  body: z.string(),
  createdAt: z.string(),
  report: z.enum(['none', 'open', 'kept']),
  /** The caller is the recipient and the item was not reported before. */
  canReport: z.boolean(),
  /** The giver, or a moderator looking at a reported item. */
  canRemove: z.boolean(),
  /** A moderator looking at an open report. */
  canKeep: z.boolean(),
});
export type FeedbackItem = z.infer<typeof feedbackItemSchema>;

export const feedbackListSchema = z.object({
  items: z.array(feedbackItemSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});
export type FeedbackList = z.infer<typeof feedbackListSchema>;
