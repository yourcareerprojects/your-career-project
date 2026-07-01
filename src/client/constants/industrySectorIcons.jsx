import React from 'react';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import AgricultureIcon from '@mui/icons-material/Agriculture';
import ArchitectureIcon from '@mui/icons-material/Architecture';
import BakeryDiningIcon from '@mui/icons-material/BakeryDining';
import BiotechIcon from '@mui/icons-material/Biotech';
import BoltIcon from '@mui/icons-material/Bolt';
import BuildIcon from '@mui/icons-material/Build';
import CalculateIcon from '@mui/icons-material/Calculate';
import CarRepairIcon from '@mui/icons-material/CarRepair';
import CategoryIcon from '@mui/icons-material/Category';
import CellTowerIcon from '@mui/icons-material/CellTower';
import CheckroomIcon from '@mui/icons-material/Checkroom';
import CleaningServicesIcon from '@mui/icons-material/CleaningServices';
import ComputerIcon from '@mui/icons-material/Computer';
import ConstructionIcon from '@mui/icons-material/Construction';
import DirectionsCarIcon from '@mui/icons-material/DirectionsCar';
import ElectricalServicesIcon from '@mui/icons-material/ElectricalServices';
import EnergySavingsLeafIcon from '@mui/icons-material/EnergySavingsLeaf';
import FactoryIcon from '@mui/icons-material/Factory';
import FlightIcon from '@mui/icons-material/Flight';
import ForestIcon from '@mui/icons-material/Forest';
import FormatPaintIcon from '@mui/icons-material/FormatPaint';
import GavelIcon from '@mui/icons-material/Gavel';
import GroupsIcon from '@mui/icons-material/Groups';
import HandymanIcon from '@mui/icons-material/Handyman';
import HardwareIcon from '@mui/icons-material/Hardware';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import HotelIcon from '@mui/icons-material/Hotel';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import LocalShippingIcon from '@mui/icons-material/LocalShipping';
import LocationCityIcon from '@mui/icons-material/LocationCity';
import LuggageIcon from '@mui/icons-material/Luggage';
import MapIcon from '@mui/icons-material/Map';
import MedicalServicesIcon from '@mui/icons-material/MedicalServices';
import MedicationIcon from '@mui/icons-material/Medication';
import MovieIcon from '@mui/icons-material/Movie';
import MuseumIcon from '@mui/icons-material/Museum';
import OpacityIcon from '@mui/icons-material/Opacity';
import ParkIcon from '@mui/icons-material/Park';
import PlumbingIcon from '@mui/icons-material/Plumbing';
import PsychologyIcon from '@mui/icons-material/Psychology';
import RestaurantIcon from '@mui/icons-material/Restaurant';
import RoofingIcon from '@mui/icons-material/Roofing';
import ScienceIcon from '@mui/icons-material/Science';
import SchoolIcon from '@mui/icons-material/School';
import ShieldIcon from '@mui/icons-material/Shield';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import SpaIcon from '@mui/icons-material/Spa';
import SportsSoccerIcon from '@mui/icons-material/SportsSoccer';
import StorefrontIcon from '@mui/icons-material/Storefront';
import TerrainIcon from '@mui/icons-material/Terrain';
import VolunteerActivismIcon from '@mui/icons-material/VolunteerActivism';
import YardIcon from '@mui/icons-material/Yard';

/** Flask with liquid accent — used for Chemistry (science). */
function ChemistryFlaskIcon(props) {
  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 24,
        height: 24,
      }}
    >
      <ScienceIcon {...props} />
      <OpacityIcon
        {...props}
        sx={{
          ...(props.sx || {}),
          position: 'absolute',
          right: -1,
          bottom: -1,
          fontSize: 12,
          opacity: 0.85,
        }}
      />
    </span>
  );
}

const INDUSTRY_SECTOR_ICON_BY_ID = {
  healthcare: LocalHospitalIcon,
  medtech: MedicalServicesIcon,
  life_sciences: BiotechIcon,
  biophysics: ScienceIcon,
  biology: ParkIcon,
  physics: BoltIcon,
  chemistry_science: ChemistryFlaskIcon,
  environmental_science: EnergySavingsLeafIcon,
  earth_sciences: TerrainIcon,
  mathematics: CalculateIcon,
  pharmaceuticals: MedicationIcon,
  finance: AccountBalanceIcon,
  insurance: ShieldIcon,
  software: ComputerIcon,
  artificial_intelligence: PsychologyIcon,
  telecommunications: CellTowerIcon,
  ecommerce: ShoppingCartIcon,
  retail: StorefrontIcon,
  manufacturing: FactoryIcon,
  automotive: DirectionsCarIcon,
  aerospace: FlightIcon,
  mobility_logistics: LocalShippingIcon,
  energy: BoltIcon,
  sustainability: EnergySavingsLeafIcon,
  agriculture: AgricultureIcon,
  food_beverage: RestaurantIcon,
  chemicals: ScienceIcon,
  mining_metals: HardwareIcon,
  construction: ConstructionIcon,
  skilled_trades: HandymanIcon,
  electrical_trades: ElectricalServicesIcon,
  plumbing_hvac: PlumbingIcon,
  metalworking: BuildIcon,
  woodworking_carpentry: ForestIcon,
  painting_finishing: FormatPaintIcon,
  roofing_building_envelope: RoofingIcon,
  automotive_trades: CarRepairIcon,
  food_trades: BakeryDiningIcon,
  beauty_personal_care: SpaIcon,
  gardening_landscaping: YardIcon,
  cleaning_facility_services: CleaningServicesIcon,
  architecture: ArchitectureIcon,
  urban_planning: MapIcon,
  real_estate: HomeWorkIcon,
  education: SchoolIcon,
  media_entertainment: MovieIcon,
  culture: MuseumIcon,
  hospitality: HotelIcon,
  tourism_travel: LuggageIcon,
  sports: SportsSoccerIcon,
  fashion_apparel: CheckroomIcon,
  legal_services: GavelIcon,
  public_sector: LocationCityIcon,
  nonprofit: VolunteerActivismIcon,
  social_work: GroupsIcon,
  defense_security: ShieldIcon,
};

const DEFAULT_INDUSTRY_SECTOR_ICON = CategoryIcon;
const DEFAULT_INDUSTRY_SECTOR_ICON_COLOR = '#5f6368';

const INDUSTRY_SECTOR_ICON_COLOR_BY_ID = {
  healthcare: '#e53935',
  medtech: '#ef5350',
  life_sciences: '#43a047',
  biophysics: '#5c6bc0',
  biology: '#2e7d32',
  physics: '#f9a825',
  chemistry_science: '#1e88e5',
  environmental_science: '#26a69a',
  earth_sciences: '#8d6e63',
  mathematics: '#3949ab',
  pharmaceuticals: '#ab47bc',
  finance: '#546e7a',
  insurance: '#455a64',
  software: '#1e88e5',
  artificial_intelligence: '#7e57c2',
  telecommunications: '#00897b',
  ecommerce: '#fb8c00',
  retail: '#ff7043',
  manufacturing: '#6d4c41',
  automotive: '#546e7a',
  aerospace: '#42a5f5',
  mobility_logistics: '#26c6da',
  energy: '#ffb300',
  sustainability: '#66bb6a',
  agriculture: '#7cb342',
  food_beverage: '#ff7043',
  chemicals: '#00acc1',
  mining_metals: '#757575',
  construction: '#8d6e63',
  skilled_trades: '#6d4c41',
  electrical_trades: '#fdd835',
  plumbing_hvac: '#29b6f6',
  metalworking: '#78909c',
  woodworking_carpentry: '#8d6e63',
  painting_finishing: '#ec407a',
  roofing_building_envelope: '#8d6e63',
  automotive_trades: '#546e7a',
  food_trades: '#ff8a65',
  beauty_personal_care: '#ec407a',
  gardening_landscaping: '#43a047',
  cleaning_facility_services: '#26c6da',
  architecture: '#8d6e63',
  urban_planning: '#5c6bc0',
  real_estate: '#8d6e63',
  education: '#3949ab',
  media_entertainment: '#ab47bc',
  culture: '#8e24aa',
  hospitality: '#ffa726',
  tourism_travel: '#29b6f6',
  sports: '#26a69a',
  fashion_apparel: '#ec407a',
  legal_services: '#5d4037',
  public_sector: '#546e7a',
  nonprofit: '#ef5350',
  social_work: '#26a69a',
  defense_security: '#546e7a',
};

export function getIndustrySectorIconComponent(industryId) {
  if (!industryId) return DEFAULT_INDUSTRY_SECTOR_ICON;
  return INDUSTRY_SECTOR_ICON_BY_ID[industryId] || DEFAULT_INDUSTRY_SECTOR_ICON;
}

export function getIndustrySectorIconColor(industryId) {
  if (!industryId) return DEFAULT_INDUSTRY_SECTOR_ICON_COLOR;
  return INDUSTRY_SECTOR_ICON_COLOR_BY_ID[industryId] || DEFAULT_INDUSTRY_SECTOR_ICON_COLOR;
}

export function IndustrySectorIcon({ industryId, fontSize = 'small', sx, ...props }) {
  const Icon = getIndustrySectorIconComponent(industryId);
  const color = getIndustrySectorIconColor(industryId);
  return <Icon fontSize={fontSize} sx={{ color: `${color} !important`, ...sx }} {...props} />;
}
