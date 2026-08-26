import { useTranslation } from 'react-i18next';
import Button from '../components/ui/Button';

/** Temporary stand-in so no link on the Landing page is a dead end. */
export default function ComingSoon({ title }) {
  const { t } = useTranslation();

  return (
    <div className="mx-auto max-w-300 px-8 py-24 text-center">
      <h1 className="m-0 text-xl font-bold">{title}</h1>
      <p className="mt-4 text-md text-text-muted">{t('common.comingSoon')}</p>
      <div className="mt-8">
        <Button to="/" variant="secondary">
          {t('common.backHome')}
        </Button>
      </div>
    </div>
  );
}
