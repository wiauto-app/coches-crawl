from __future__ import annotations

import scrapy


class CrawlJobItem(scrapy.Item):
    version_id = scrapy.Field()
    url = scrapy.Field()
    brand = scrapy.Field()
    model = scrapy.Field()
    version_name = scrapy.Field()
    body_type = scrapy.Field()
    doors = scrapy.Field()
    fuel_type = scrapy.Field()
    year_from = scrapy.Field()
    year_to = scrapy.Field()
    hp = scrapy.Field()


class TechnicalSheetItem(scrapy.Item):
    version_id = scrapy.Field()
    make_id = scrapy.Field()
    model_id = scrapy.Field()
    brand = scrapy.Field()
    model = scrapy.Field()
    version_name = scrapy.Field()
    body_type = scrapy.Field()
    doors = scrapy.Field()
    year = scrapy.Field()
    fuel = scrapy.Field()
    power = scrapy.Field()
    engine = scrapy.Field()
    gearbox = scrapy.Field()
    traction = scrapy.Field()
    price = scrapy.Field()
    init_marketed_date = scrapy.Field()
    url = scrapy.Field()
    images = scrapy.Field()
    marketed_versions = scrapy.Field()
    specifications = scrapy.Field()
