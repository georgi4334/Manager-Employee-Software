import { SKILL_LEVELS } from '@intime/contracts';
import { useTranslation } from 'react-i18next';
import { formatDate } from '@/shared/lib/format';
import { Alert } from '@/shared/ui/alert';
import { Select } from '@/shared/ui/select';
import { useCatalog, usePerson, useRemoveRating, useSetRating } from './hooks';
import { useSkillErrors } from './use-skill-errors';

/** One person's levels, a select per skill. Whether they may be changed is decided by the server (`canEdit`). */
export function RatingEditor({ employeeId }: { employeeId: string }) {
  const { t, i18n } = useTranslation('skills');
  const language = i18n.resolvedLanguage ?? 'en';
  const errors = useSkillErrors();
  const catalog = useCatalog();
  const person = usePerson(employeeId);
  const set = useSetRating(employeeId);
  const remove = useRemoveRating(employeeId);
  const error = set.error ?? remove.error ?? catalog.error ?? person.error;

  if (catalog.isPending || person.isPending) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('loading')}
      </p>
    );
  }
  if (!catalog.data || !person.data) {
    return <Alert tone="danger">{errors.apiError(error)}</Alert>;
  }
  const ratings = new Map(person.data.ratings.map((r) => [r.skillId, r]));
  const canEdit = person.data.canEdit;
  const categories = catalog.data.categories
    .map((c) => ({
      ...c,
      // Archived skills show only where the person already has a level.
      skills: c.skills.filter((s) => !s.archived || ratings.has(s.id)),
    }))
    .filter((c) => c.skills.length > 0);

  if (categories.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('emptyCatalog')}</p>;
  }
  return (
    <div className="space-y-4">
      {error && <Alert tone="danger">{errors.apiError(error)}</Alert>}
      {categories.map((c) => (
        <section key={c.id} aria-labelledby={`cat-${employeeId}-${c.id}`} className="space-y-2">
          <h3 id={`cat-${employeeId}-${c.id}`} className="text-sm font-semibold">
            {c.name}
          </h3>
          <ul className="space-y-2">
            {c.skills.map((s) => {
              const r = ratings.get(s.id);
              return (
                <li key={s.id} className="grid gap-1 sm:grid-cols-2 sm:items-center">
                  <div>
                    <p className="break-words font-medium">
                      {s.name}
                      {s.archived && ` (${t('archived')})`}
                    </p>
                    {s.description && (
                      <p className="text-xs text-muted-foreground">{s.description}</p>
                    )}
                    {r && (
                      <p className="text-xs text-muted-foreground">
                        {r.selfAssessed
                          ? t('assessed.self', { date: formatDate(r.assessedAt, language) })
                          : t('assessed.by', {
                              name: r.assessedBy
                                ? `${r.assessedBy.firstName} ${r.assessedBy.lastName}`
                                : '—',
                              date: formatDate(r.assessedAt, language),
                            })}
                      </p>
                    )}
                  </div>
                  <Select
                    aria-label={t('levelOf', { skill: s.name })}
                    value={r ? String(r.level) : ''}
                    disabled={!canEdit || set.isPending || remove.isPending || (s.archived && !r)}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === '') remove.mutate(s.id);
                      else set.mutate({ skillId: s.id, level: Number(value) });
                    }}
                  >
                    <option value="">{t('notRated')}</option>
                    {SKILL_LEVELS.map((level) => (
                      <option key={level} value={level}>
                        {level} · {t(`level.${level}`)}
                      </option>
                    ))}
                  </Select>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
