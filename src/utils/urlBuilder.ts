import type { TechnicalSheetUrlInput } from '../types/technicalSheet.js';
import { slugify } from './slugify.js';

const COCHES_BASE_URL = 'https://www.coches.net';

const BODY_TYPE_SLUGS: Readonly<Record<number, string>> = {
  1: 'berlina',
  2: 'coupe',
  3: 'cabrio',
  4: 'familiar',
  6: '4x4',
};

const assertPositiveInteger = (value: number, fieldName: string): void => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} debe ser un entero positivo`);
  }
};

const createRequiredSlug = (value: string, fieldName: string): string => {
  const slug = slugify(value);

  if (!slug) {
    throw new Error(`${fieldName} no permite construir un slug válido`);
  }

  return slug;
};

const normalizeStoredPath = (technicalUrlPath: string): string => {
  const trimmedPath = technicalUrlPath.trim();

  if (!trimmedPath.startsWith('/')) {
    throw new Error('technicalUrlPath debe ser una ruta absoluta');
  }

  return trimmedPath.endsWith('/') ? trimmedPath : `${trimmedPath}/`;
};

export const buildTechnicalSheetPath = (
  input: TechnicalSheetUrlInput
): string => {
  if (input.technicalUrlPath?.trim()) {
    return normalizeStoredPath(input.technicalUrlPath);
  }

  assertPositiveInteger(input.versionId, 'versionId');
  assertPositiveInteger(input.bodyTypeId, 'bodyTypeId');
  assertPositiveInteger(input.doors, 'doors');

  const bodySlug = BODY_TYPE_SLUGS[input.bodyTypeId];

  if (!bodySlug) {
    throw new Error(`bodyTypeId no soportado: ${input.bodyTypeId}`);
  }

  const makeSlug = createRequiredSlug(input.makeName, 'makeName');
  const modelSlug = createRequiredSlug(input.modelName, 'modelName');
  const versionSlug = createRequiredSlug(input.versionName, 'versionName');
  const doorsSlug = `${input.doors}-puertas`;

  return `/fichas_tecnicas/${makeSlug}/${modelSlug}/${bodySlug}/${doorsSlug}/${versionSlug}/${input.versionId}/`;
};

export const buildTechnicalSheetUrl = (
  input: TechnicalSheetUrlInput,
  baseUrl = COCHES_BASE_URL
): string => {
  return new URL(buildTechnicalSheetPath(input), baseUrl).href;
};
