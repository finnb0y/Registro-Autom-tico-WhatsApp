import { LucideIcon } from 'lucide-react';

type FeatureCardProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  iconColor?: string;
  onClick?: () => void;
  linkLabel?: string;
};

const FeatureCard = ({
  icon: Icon,
  title,
  description,
  iconColor = 'bg-emerald-600',
  onClick,
  linkLabel = 'Entrar →',
}: FeatureCardProps) => {
  return (
    <article
      className={`glass-card p-5 flex flex-col gap-4 ${onClick ? 'cursor-pointer hover:-translate-y-0.5 transition-transform duration-200' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-start gap-4">
        <div
          className={`w-12 h-12 rounded-lg flex items-center justify-center ${iconColor} text-white shadow-sm shrink-0`}
        >
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-slate-100">{title}</h3>
          <p className="mt-1 text-sm text-slate-300">{description}</p>
        </div>
      </div>

      {onClick && (
        <div className="mt-auto">
          <span className="inline-flex items-center gap-1 text-sm text-emerald-300 hover:text-emerald-200">
            {linkLabel}
          </span>
        </div>
      )}
    </article>
  );
};

export default FeatureCard;
