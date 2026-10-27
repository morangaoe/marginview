"""One-shot Scrapy fetch: `python fetch_spider.py <url>` prints {"status": int, "html": str} as JSON.

Scrapy handles retries, redirects, cookies, gzip, robots.txt and a realistic header set. Extraction
stays in the API (priceExtractor.ts), so selectors and JSON-LD parsing behave the same on every tier.
"""
import json
import os
import sys

import scrapy
from scrapy.crawler import CrawlerProcess

MAX_BYTES = 3_000_000


class FetchSpider(scrapy.Spider):
    name = "fetch"
    custom_settings = {
        "LOG_LEVEL": "ERROR",
        "ROBOTSTXT_OBEY": os.getenv("SCRAPY_OBEY_ROBOTS", "true").lower() == "true",
        "USER_AGENT": os.getenv(
            "SCRAPY_USER_AGENT",
            "Mozilla/5.0 (compatible; MarginViewBot/1.0; +https://marginview.app/bot)",
        ),
        "RETRY_TIMES": 1,
        "DOWNLOAD_TIMEOUT": 20,
        "DOWNLOAD_MAXSIZE": MAX_BYTES,
        "TELNETCONSOLE_ENABLED": False,
        "HTTPERROR_ALLOW_ALL": True,  # report 403/429 to the API instead of raising
        "DEFAULT_REQUEST_HEADERS": {
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "en-US,en;q=0.9",
        },
    }

    def __init__(self, url, result, **kw):
        super().__init__(**kw)
        self.target, self.result = url, result

    def start_requests(self):
        proxy = os.getenv("SCRAPY_PROXY")  # optional, e.g. http://user:pass@host:port
        meta = {"proxy": proxy} if proxy else {}
        yield scrapy.Request(self.target, callback=self.parse, errback=self.fail, meta=meta, dont_filter=True)

    def parse(self, response):
        self.result.update(status=response.status, html=response.text[:MAX_BYTES])

    def fail(self, failure):
        self.result.update(status=0, html="", error=repr(failure.value))


def main(url):
    result = {"status": 0, "html": ""}
    process = CrawlerProcess()
    process.crawl(FetchSpider, url=url, result=result)
    process.start()
    print(json.dumps(result))


if __name__ == "__main__":
    main(sys.argv[1])
