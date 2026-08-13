import type {
  MarketedVersion,
  TechnicalSheetFieldValue,
  TechnicalSheetImage,
  TechnicalSheetInitialProps,
  TechnicalSheetPageInfo,
  TechnicalSheetSpecifications,
} from '../types/technicalSheet.js';

const INITIAL_PROPS_MARKER = 'window.__INITIAL_PROPS__';
const JSON_PARSE_CALL = 'JSON.parse';

const SPECIFICATION_FIELDS = [
  'acceleration',
  'consumptionAverage',
  'consumptionExtraUrban',
  'consumptionUrban',
  'cubicCapacity',
  'cylinders',
  'distribution',
  'doors',
  'emissions',
  'fuelTankCapacity',
  'fuelType',
  'gearBox',
  'height',
  'hp',
  'hpRpm',
  'length',
  'luggageCapacity',
  'seats',
  'supply',
  'topSpeed',
  'torque',
  'torqueRpm',
  'traction',
  'weight',
  'width',
] as const satisfies ReadonlyArray<keyof TechnicalSheetSpecifications>;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const skipWhitespace = (source: string, startIndex: number): number => {
  let index = startIndex;

  while (index < source.length && /\s/.test(source[index] ?? '')) {
    index += 1;
  }

  return index;
};

const findSerializedJsonString = (html: string): string => {
  let searchIndex = 0;

  while (searchIndex < html.length) {
    const markerIndex = html.indexOf(INITIAL_PROPS_MARKER, searchIndex);

    if (markerIndex === -1) {
      break;
    }

    let index = skipWhitespace(html, markerIndex + INITIAL_PROPS_MARKER.length);

    if (html[index] !== '=') {
      searchIndex = markerIndex + INITIAL_PROPS_MARKER.length;
      continue;
    }

    index = skipWhitespace(html, index + 1);

    if (!html.startsWith(JSON_PARSE_CALL, index)) {
      searchIndex = markerIndex + INITIAL_PROPS_MARKER.length;
      continue;
    }

    index = skipWhitespace(html, index + JSON_PARSE_CALL.length);

    if (html[index] !== '(') {
      searchIndex = markerIndex + INITIAL_PROPS_MARKER.length;
      continue;
    }

    index = skipWhitespace(html, index + 1);

    if (html[index] !== '"') {
      throw new Error(
        '__INITIAL_PROPS__ debe usar una cadena JSON serializada entre comillas dobles'
      );
    }

    const stringStartIndex = index;
    let isEscaped = false;
    index += 1;

    while (index < html.length) {
      const character = html[index];

      if (isEscaped) {
        isEscaped = false;
      } else if (character === '\\') {
        isEscaped = true;
      } else if (character === '"') {
        const stringEndIndex = index + 1;
        const closingParenthesisIndex = skipWhitespace(html, stringEndIndex);

        if (html[closingParenthesisIndex] !== ')') {
          throw new Error(
            'La llamada JSON.parse de __INITIAL_PROPS__ está incompleta'
          );
        }

        return html.slice(stringStartIndex, stringEndIndex);
      }

      index += 1;
    }

    throw new Error(
      'La cadena serializada de __INITIAL_PROPS__ no está terminada'
    );
  }

  throw new Error('No se encontró la asignación de window.__INITIAL_PROPS__');
};

const coercePositiveInteger = (value: unknown, fieldPath: string): number => {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = parseInt(value.trim(), 10);
    if (parsed > 0) {
      return parsed;
    }
  }

  throw new Error(`${fieldPath} debe ser un entero positivo`);
};

const coerceOptionalDoors = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const match = value.match(/(\d+)/);
    if (match?.[1]) {
      return parseInt(match[1], 10);
    }
  }

  return null;
};

const assertNullableString: (
  value: unknown,
  fieldPath: string
) => asserts value is string | null = (value, fieldPath) => {
  if (value !== null && typeof value !== 'string') {
    throw new Error(`${fieldPath} debe ser string o null`);
  }
};

const assertTechnicalFieldValue: (
  value: unknown,
  fieldPath: string
) => asserts value is TechnicalSheetFieldValue = (value, fieldPath) => {
  if (
    value !== null &&
    typeof value !== 'string' &&
    (typeof value !== 'number' || !Number.isFinite(value))
  ) {
    throw new Error(`${fieldPath} debe ser string, number o null`);
  }
};

const parseSpecifications = (
  value: unknown
): TechnicalSheetSpecifications => {
  if (!isRecord(value)) {
    throw new Error('pageInfoResponse.specifications debe ser un objeto');
  }

  for (const field of SPECIFICATION_FIELDS) {
    assertTechnicalFieldValue(
      value[field],
      `pageInfoResponse.specifications.${field}`
    );
  }

  return value as unknown as TechnicalSheetSpecifications;
};

const parseImages = (value: unknown): TechnicalSheetImage[] => {
  if (!Array.isArray(value)) {
    throw new Error('pageInfoResponse.images debe ser un array');
  }

  return value.map((image, index) => {
    if (!isRecord(image) || typeof image.src !== 'string') {
      throw new Error(
        `pageInfoResponse.images[${index}].src debe ser string`
      );
    }

    return { src: image.src };
  });
};

const parseMarketedVersions = (value: unknown): MarketedVersion[] => {
  if (!Array.isArray(value)) {
    throw new Error('pageInfoResponse.marketedVersions debe ser un array');
  }

  return value.map((marketedVersion, index) => {
    if (!isRecord(marketedVersion)) {
      throw new Error(
        `pageInfoResponse.marketedVersions[${index}] debe ser un objeto`
      );
    }

    const fieldPath = `pageInfoResponse.marketedVersions[${index}]`;
    assertTechnicalFieldValue(
      marketedVersion.price,
      `${fieldPath}.price`
    );
    assertNullableString(marketedVersion.url, `${fieldPath}.url`);
    assertNullableString(marketedVersion.initDate, `${fieldPath}.initDate`);
    assertNullableString(marketedVersion.endDate, `${fieldPath}.endDate`);

    return {
      price: marketedVersion.price,
      url: marketedVersion.url,
      initDate: marketedVersion.initDate,
      endDate: marketedVersion.endDate,
    };
  });
};

const pickNullableString = (
  ...candidates: unknown[]
): string | null => {
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      return candidate;
    }
  }

  return null;
};

const pickNullableNumber = (
  ...candidates: unknown[]
): number | null => {
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  return null;
};

/**
 * En el HTML real, versionId / slugs viven en la raíz de __INITIAL_PROPS__,
 * mientras que specs/images viven en pageInfoResponse.
 */
const parsePageInfo = (
  root: Record<string, unknown>,
  pageInfo: unknown
): TechnicalSheetPageInfo => {
  if (!isRecord(pageInfo)) {
    throw new Error('pageInfoResponse debe ser un objeto');
  }

  const versionId = coercePositiveInteger(
    root.versionId ?? pageInfo.versionId,
    'versionId'
  );

  const makeUrlParam = pickNullableString(
    root.makeUrlParam,
    pageInfo.makeUrlParam,
    root.make
  );
  const modelUrlParam = pickNullableString(
    root.modelUrlParam,
    pageInfo.modelUrlParam,
    root.model
  );
  const bodyType = pickNullableString(root.bodyType, pageInfo.bodyType);
  const version = pickNullableString(root.version, pageInfo.version);
  const year = pickNullableNumber(pageInfo.year, root.year);
  const doors =
    coerceOptionalDoors(root.doors) ??
    coerceOptionalDoors(pageInfo.doors) ??
    coerceOptionalDoors(
      isRecord(pageInfo.specifications)
        ? pageInfo.specifications.doors
        : null
    );

  assertTechnicalFieldValue(pageInfo.price, 'pageInfoResponse.price');
  assertNullableString(
    pageInfo.initMarketedDate ?? null,
    'pageInfoResponse.initMarketedDate'
  );

  return {
    versionId,
    makeUrlParam,
    modelUrlParam,
    bodyType,
    doors,
    version,
    year,
    price: pageInfo.price as TechnicalSheetFieldValue,
    initMarketedDate:
      typeof pageInfo.initMarketedDate === 'string'
        ? pageInfo.initMarketedDate
        : null,
    specifications: parseSpecifications(pageInfo.specifications),
    images: parseImages(pageInfo.images),
    marketedVersions: parseMarketedVersions(pageInfo.marketedVersions),
  };
};

export const parseInitialProps = (html: string): TechnicalSheetInitialProps => {
  if (!html.trim()) {
    throw new Error('El HTML no puede estar vacío');
  }

  const serializedJsonString = findSerializedJsonString(html);

  let jsonText: unknown;

  try {
    jsonText = JSON.parse(serializedJsonString);
  } catch {
    throw new Error(
      'No se pudo decodificar la cadena serializada de __INITIAL_PROPS__'
    );
  }

  if (typeof jsonText !== 'string') {
    throw new Error('__INITIAL_PROPS__ no contiene una cadena JSON válida');
  }

  let parsedValue: unknown;

  try {
    parsedValue = JSON.parse(jsonText);
  } catch {
    throw new Error('El contenido de __INITIAL_PROPS__ no es JSON válido');
  }

  if (!isRecord(parsedValue)) {
    throw new Error('__INITIAL_PROPS__ debe contener un objeto');
  }

  return {
    pageInfoResponse: parsePageInfo(parsedValue, parsedValue.pageInfoResponse),
  };
};
