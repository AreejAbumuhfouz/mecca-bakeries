import type { Metadata } from 'next';
import { t } from '@/lib/i18n';

export const metadata: Metadata = {
  title: t('سياسة الخصوصية — مخابز مكة'),
  description: t('كيف يتعامل نظام وتطبيق مخابز مكة مع بيانات المستخدمين'),
};

// Filled per deployment, so the page names the right owner and contact.
const OWNER = process.env.NEXT_PUBLIC_OWNER_NAME || t('شركة مالك عيال عواد وشركاه (مخابز مكة)');
const EMAIL = process.env.NEXT_PUBLIC_PRIVACY_EMAIL || '';
const PHONE = process.env.NEXT_PUBLIC_PRIVACY_PHONE || '';
const UPDATED = '2026-12-01';

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="space-y-2">
    <h2 className="text-lg font-bold text-brand-brown">{title}</h2>
    <div className="space-y-2 leading-8 text-ink">{children}</div>
  </section>
);

/** Public page; the app stores link to it. */
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <header className="space-y-1 border-b border-brand-line pb-4">
        <h1 className="text-2xl font-bold text-brand-brown">{t('سياسة الخصوصية')}</h1>
        <p className="text-sm text-brand-muted">
          {t('لنظام مخابز مكة (لوحة التحكم وتطبيق الجوال) — آخر تحديث {0}', UPDATED)}
        </p>
      </header>

      <Section title={t('من نحن')}>
        <p>
          {t(
            'النظام والتطبيق مملوكان لـ {0}، ويُستخدمان لإدارة طلبات الخبز والمعجنات من المطاعم والعملاء، وتوزيعها، وإصدار فواتيرها وتحصيلها. الحسابات يُنشئها المخبز لعملائه وموظفيه؛ لا يمكن لأي شخص التسجيل بنفسه.',
            OWNER,
          )}
        </p>
      </Section>

      <Section title={t('البيانات التي نجمعها')}>
        <ul className="list-disc space-y-1 pe-6">
          <li>{t('بيانات الحساب: الاسم، البريد الإلكتروني، والدور (مطعم، سائق، موظف).')}</li>
          <li>{t('بيانات العميل: اسم المطعم وفروعه، أرقام الهاتف، العناوين، وشروط العقد.')}</li>
          <li>{t('الطلبات والفواتير والمدفوعات وكشوف الحساب.')}</li>
          <li>
            {t('للسائقين فقط: الموقع الجغرافي')} <b>{t('لحظة تأكيد التسليم فقط')}</b>
            {t(
              '، واسم المستلم أو توقيعه. لا يتتبع التطبيق موقع السائق في أي وقت آخر ولا في الخلفية.',
            )}
          </li>
          <li>{t('رمز الإشعارات للجهاز (لإرسال تذكير الطلب وتحديثاته).')}</li>
          <li>{t('سجلات تقنية: عنوان IP ووقت العمليات، لحماية الحسابات وتتبع التعديلات.')}</li>
        </ul>
      </Section>

      <Section title={t('لماذا نستخدمها')}>
        <ul className="list-disc space-y-1 pe-6">
          <li>{t('استلام الطلبات وتجهيزها وتوصيلها وإصدار فواتيرها.')}</li>
          <li>{t('إثبات التسليم (الوقت والموقع والمستلم) عند أي خلاف.')}</li>
          <li>{t('إرسال تأكيد الطلب والتذكير وكشف الحساب على واتساب والتطبيق.')}</li>
          <li>{t('حماية الحسابات وسجل تدقيق لكل تعديل (من، ومتى، وما الذي تغيّر).')}</li>
        </ul>
        <p>{t('لا نستخدم البيانات للإعلانات، ولا نبيعها لأي جهة.')}</p>
      </Section>

      <Section title={t('مع من نشاركها')}>
        <p>{t('فقط مع مزوّدي الخدمة اللازمين لتشغيل النظام، وبالقدر اللازم:')}</p>
        <ul className="list-disc space-y-1 pe-6">
          <li>{t('Meta (واتساب للأعمال) لإرسال رسائل الطلبات وكشوف الحساب إلى رقم العميل.')}</li>
          <li>{t('Expo لإرسال إشعارات التطبيق.')}</li>
          <li>{t('مزوّد البريد الإلكتروني لإرسال رمز الدخول.')}</li>
          <li>
            {t('مزوّد الاستضافة والنسخ الاحتياطي حيث تُحفظ البيانات مشفّرة أثناء النقل (SSL).')}
          </li>
        </ul>
      </Section>

      <Section title={t('مدة الاحتفاظ')}>
        <p>
          {t(
            'تُحفظ الفواتير والمدفوعات والطلبات طوال مدة التعامل وبما تتطلبه حسابات المخبز. يُحذف رمز الدخول بعد استخدامه أو انتهاء صلاحيته خلال دقائق.',
          )}
        </p>
      </Section>

      <Section title={t('حقوقك')}>
        <p>
          {t(
            'يمكنك طلب نسخة من بياناتك أو تصحيحها أو حذف حسابك بالتواصل مع المخبز. الفواتير والمدفوعات قد نحتفظ بها لأسباب محاسبية حتى بعد إغلاق الحساب.',
          )}
        </p>
      </Section>

      <Section title={t('التواصل')}>
        <p>
          {OWNER}
          {EMAIL && (
            <>
              {' '}
              {t('— البريد:')}{' '}
              <span dir="ltr" className="select-all font-mono">
                {EMAIL}
              </span>
            </>
          )}
          {PHONE && (
            <>
              {' '}
              {t('— الهاتف:')}{' '}
              <span dir="ltr" className="select-all font-mono">
                {PHONE}
              </span>
            </>
          )}
        </p>
      </Section>
    </main>
  );
}
