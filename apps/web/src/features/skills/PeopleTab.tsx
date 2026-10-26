import { SKILL_LEVELS, type SkillLevel } from '@intime/contracts';
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Select } from '@/shared/ui/select';
import { PAGE_SIZE } from './api';
import { useCatalog, usePeople } from './hooks';
import { RatingEditor } from './RatingEditor';
import { useSkillErrors } from './use-skill-errors';

export function PeopleTab() {
  const { t } = useTranslation('skills');
  const errors = useSkillErrors();
  const catalog = useCatalog();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [skillId, setSkillId] = useState('');
  const [minLevel, setMinLevel] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const query = usePeople({ q, categoryId, skillId, minLevel, page });
  const data = query.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const skills = (catalog.data?.categories ?? []).flatMap((c) => c.skills);
  const skillName = new Map(skills.map((s) => [s.id, s.name]));
  const categoryName = new Map(
    (catalog.data?.categories ?? []).flatMap((c) => c.skills.map((s) => [s.id, c.name] as const)),
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="relative sm:col-span-2">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            className="pl-9"
            aria-label={t('search')}
            placeholder={t('search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          aria-label={t('filters.category')}
          value={categoryId}
          onChange={(e) => {
            setCategoryId(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('filters.allCategories')}</option>
          {(catalog.data?.categories ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <div className="grid grid-cols-2 gap-2">
          <Select
            aria-label={t('filters.skill')}
            value={skillId}
            onChange={(e) => {
              setSkillId(e.target.value);
              if (!e.target.value) setMinLevel('');
              setPage(1);
            }}
          >
            <option value="">{t('filters.anySkill')}</option>
            {skills.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t('filters.minLevel')}
            value={minLevel}
            disabled={!skillId}
            onChange={(e) => {
              setMinLevel(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('filters.anyLevel')}</option>
            {SKILL_LEVELS.map((level) => (
              <option key={level} value={level}>
                {t('filters.atLeast', { level })}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {query.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('loading')}
        </p>
      )}
      {query.isError && (
        <Card className="space-y-3 text-center">
          <Alert tone="danger">{errors.apiError(query.error)}</Alert>
          <Button onClick={() => void query.refetch()}>{t('retry')}</Button>
        </Card>
      )}
      {data && (
        <>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {t('total', { count: data.total })}
          </p>
          {data.items.length === 0 ? (
            <Card>
              <p className="text-center text-sm text-muted-foreground">{t('empty')}</p>
            </Card>
          ) : (
            <ul className="space-y-2" aria-label={t('tabs.people')}>
              {data.items.map((p) => {
                const name = `${p.employee.firstName} ${p.employee.lastName}`;
                return (
                  <li
                    key={p.employee.id}
                    className="space-y-2 rounded-xl border border-border bg-surface p-4 shadow-card"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{name}</p>
                      {p.canEdit && (
                        <Button
                          variant="secondary"
                          aria-expanded={editing === p.employee.id}
                          onClick={() =>
                            setEditing(editing === p.employee.id ? null : p.employee.id)
                          }
                        >
                          {editing === p.employee.id ? t('closeEditor') : t('editSkills', { name })}
                        </Button>
                      )}
                    </div>
                    {p.ratings.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t('noRatings')}</p>
                    ) : (
                      <ul className="flex flex-wrap gap-2" aria-label={t('skillsOf', { name })}>
                        {p.ratings.map((r) => (
                          <li
                            key={r.skillId}
                            className="rounded-full border border-border px-3 py-1 text-sm"
                            title={categoryName.get(r.skillId)}
                          >
                            {skillName.get(r.skillId) ?? '—'} ·{' '}
                            {t(`level.${r.level as SkillLevel}`)} ({r.level}
                            /5)
                          </li>
                        ))}
                      </ul>
                    )}
                    {editing === p.employee.id && <RatingEditor employeeId={p.employee.id} />}
                  </li>
                );
              })}
            </ul>
          )}
          {pages > 1 && (
            <nav className="flex items-center justify-between gap-2" aria-label={t('pagination')}>
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                {t('previous')}
              </Button>
              <span className="text-sm text-muted-foreground">{t('page', { page, pages })}</span>
              <Button
                variant="secondary"
                disabled={page >= pages}
                onClick={() => setPage(page + 1)}
              >
                {t('next')}
              </Button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
