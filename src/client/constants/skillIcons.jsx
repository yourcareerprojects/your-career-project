import React from 'react';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import AgricultureIcon from '@mui/icons-material/Agriculture';
import AnalyticsIcon from '@mui/icons-material/Analytics';
import ArchitectureIcon from '@mui/icons-material/Architecture';
import AssignmentIcon from '@mui/icons-material/Assignment';
import BiotechIcon from '@mui/icons-material/Biotech';
import BuildIcon from '@mui/icons-material/Build';
import CalculateIcon from '@mui/icons-material/Calculate';
import CategoryIcon from '@mui/icons-material/Category';
import ComputerIcon from '@mui/icons-material/Computer';
import ConstructionIcon from '@mui/icons-material/Construction';
import DesignServicesIcon from '@mui/icons-material/DesignServices';
import EngineeringIcon from '@mui/icons-material/Engineering';
import GavelIcon from '@mui/icons-material/Gavel';
import GroupsIcon from '@mui/icons-material/Groups';
import HandymanIcon from '@mui/icons-material/Handyman';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import MovieIcon from '@mui/icons-material/Movie';
import PsychologyIcon from '@mui/icons-material/Psychology';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';
import SchoolIcon from '@mui/icons-material/School';
import ScienceIcon from '@mui/icons-material/Science';
import ShieldIcon from '@mui/icons-material/Shield';
import StorefrontIcon from '@mui/icons-material/Storefront';
import SupportAgentIcon from '@mui/icons-material/SupportAgent';
import VerifiedIcon from '@mui/icons-material/Verified';
import {
  DEFAULT_SKILL_ICON_COLOR,
  SKILL_ICON_RULES,
  getSkillIconColor,
  normalizeSkillMatchText,
  resolveSkillIconCategory,
} from './skillIconMatching';

export {
  DEFAULT_SKILL_ICON_COLOR,
  SKILL_ICON_RULES,
  normalizeSkillMatchText,
  resolveSkillIconCategory,
  getSkillIconColor,
} from './skillIconMatching';

const DEFAULT_SKILL_ICON = CategoryIcon;

const SKILL_ICON_BY_ID = {
  health: LocalHospitalIcon,
  science: ScienceIcon,
  data: AnalyticsIcon,
  software: ComputerIcon,
  design: DesignServicesIcon,
  media: MovieIcon,
  communication: RecordVoiceOverIcon,
  customer: SupportAgentIcon,
  finance: AccountBalanceIcon,
  legal: GavelIcon,
  education: SchoolIcon,
  leadership: AssignmentIcon,
  teamwork: GroupsIcon,
  safety: ShieldIcon,
  quality: VerifiedIcon,
  logistics: LocalShippingIcon,
  agriculture: AgricultureIcon,
  construction: ConstructionIcon,
  engineering: EngineeringIcon,
  craft: HandymanIcon,
  architecture: ArchitectureIcon,
  counselling: PsychologyIcon,
  math: CalculateIcon,
  retail: StorefrontIcon,
  manufacturing: BuildIcon,
  biotech: BiotechIcon,
};

export function getSkillIconComponent(categoryId) {
  if (!categoryId) return DEFAULT_SKILL_ICON;
  return SKILL_ICON_BY_ID[categoryId] || DEFAULT_SKILL_ICON;
}

export function SkillIcon({ skillKey, skillLabel, categoryId, fontSize = 'small', sx, ...props }) {
  const resolvedCategory = categoryId ?? resolveSkillIconCategory(skillKey, skillLabel);
  const Icon = getSkillIconComponent(resolvedCategory);
  const color = getSkillIconColor(resolvedCategory);
  return <Icon fontSize={fontSize} sx={{ color: `${color} !important`, ...sx }} {...props} />;
}
