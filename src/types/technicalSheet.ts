export type TechnicalSheetFieldValue = string | number | null;

export interface TechnicalSheetSpecifications {
  acceleration: TechnicalSheetFieldValue;
  consumptionAverage: TechnicalSheetFieldValue;
  consumptionExtraUrban: TechnicalSheetFieldValue;
  consumptionUrban: TechnicalSheetFieldValue;
  cubicCapacity: TechnicalSheetFieldValue;
  cylinders: TechnicalSheetFieldValue;
  distribution: TechnicalSheetFieldValue;
  doors: TechnicalSheetFieldValue;
  emissions: TechnicalSheetFieldValue;
  fuelTankCapacity: TechnicalSheetFieldValue;
  fuelType: TechnicalSheetFieldValue;
  gearBox: TechnicalSheetFieldValue;
  height: TechnicalSheetFieldValue;
  hp: TechnicalSheetFieldValue;
  hpRpm: TechnicalSheetFieldValue;
  length: TechnicalSheetFieldValue;
  luggageCapacity: TechnicalSheetFieldValue;
  seats: TechnicalSheetFieldValue;
  supply: TechnicalSheetFieldValue;
  topSpeed: TechnicalSheetFieldValue;
  torque: TechnicalSheetFieldValue;
  torqueRpm: TechnicalSheetFieldValue;
  traction: TechnicalSheetFieldValue;
  weight: TechnicalSheetFieldValue;
  width: TechnicalSheetFieldValue;
}

export interface TechnicalSheetImage {
  src: string;
}

export interface MarketedVersion {
  price: TechnicalSheetFieldValue;
  url: string | null;
  initDate: string | null;
  endDate: string | null;
}

export interface TechnicalSheetPageInfo {
  versionId: number;
  makeUrlParam: string | null;
  modelUrlParam: string | null;
  bodyType: string | null;
  doors: number | null;
  version: string | null;
  year: number | null;
  price: TechnicalSheetFieldValue;
  initMarketedDate: string | null;
  specifications: TechnicalSheetSpecifications;
  images: TechnicalSheetImage[];
  marketedVersions: MarketedVersion[];
}

export interface TechnicalSheetInitialProps {
  pageInfoResponse: TechnicalSheetPageInfo;
}

export interface VersionSpecification
  extends TechnicalSheetSpecifications {
  versionId: number;
  year: number | null;
  price: TechnicalSheetFieldValue;
  initMarketedDate: string | null;
  images: TechnicalSheetImage[];
  marketedVersions: MarketedVersion[];
}

export interface TechnicalSheetUrlInput {
  versionId: number;
  makeName: string;
  modelName: string;
  bodyTypeId: number;
  doors: number;
  versionName: string;
  technicalUrlPath?: string | null;
}

export type InitialProps = TechnicalSheetInitialProps;

export interface VersionSpecificationRow {
  id: number;
  version_id: number;
  acceleration: string | null;
  consumption_average: string | null;
  consumption_extra_urban: string | null;
  consumption_urban: string | null;
  cubic_capacity: number | null;
  cylinders: number | null;
  distribution: string | null;
  doors: number | null;
  emissions: string | null;
  fuel_tank_capacity: string | null;
  fuel_type: string | null;
  gear_box: string | null;
  height: number | null;
  length: number | null;
  width: number | null;
  weight: number | null;
  hp: number | null;
  hp_rpm: number | null;
  torque: string | null;
  torque_rpm: number | null;
  seats: number | null;
  luggage_capacity: number | null;
  supply: string | null;
  traction: string | null;
  top_speed: number | null;
  year: number | null;
  price: string | null;
  init_marketed_date: string | null;
  images: TechnicalSheetImage[] | null;
  marketed_versions: MarketedVersion[] | null;
  scraped_at: string;
  crawl_id: string | null;
}
