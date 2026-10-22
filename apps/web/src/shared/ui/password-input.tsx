import { Eye, EyeOff } from 'lucide-react';
import { useState, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { Input, type InputProps } from './input';

export function PasswordInput({
  ref,
  ...props
}: Omit<InputProps, 'type'> & { ref?: Ref<HTMLInputElement> }) {
  const { t } = useTranslation('common');
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;

  return (
    <div className="relative">
      <Input ref={ref} type={visible ? 'text' : 'password'} className="pr-12" {...props} />
      <button
        type="button"
        aria-pressed={visible}
        aria-label={visible ? t('hidePassword') : t('showPassword')}
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground"
      >
        <Icon className="size-5" aria-hidden="true" />
      </button>
    </div>
  );
}
