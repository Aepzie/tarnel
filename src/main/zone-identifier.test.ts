import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatZoneIdentifier, zoneUrl } from './zone-identifier';

describe('formatZoneIdentifier', () => {
  it('writes zone, referrer and host with CRLF', () => {
    assert.equal(
      formatZoneIdentifier({ hostUrl: 'https://cdn.example.com/a.exe', referrerUrl: 'https://example.com/download' }),
      '[ZoneTransfer]\r\nZoneId=3\r\nReferrerUrl=https://example.com/download\r\nHostUrl=https://cdn.example.com/a.exe\r\n',
    );
  });
  it('omits non-http(s) URLs but keeps the zone', () => {
    assert.equal(
      formatZoneIdentifier({ hostUrl: 'blob:https://example.com/uuid', referrerUrl: 'tarnel://newtab' }),
      '[ZoneTransfer]\r\nZoneId=3\r\n',
    );
    assert.equal(formatZoneIdentifier({ hostUrl: 'data:text/plain,hi' }), '[ZoneTransfer]\r\nZoneId=3\r\n');
  });
  it('omits URLs for burner sessions', () => {
    assert.equal(
      formatZoneIdentifier({ hostUrl: 'https://example.com/a.zip', referrerUrl: 'https://example.com/', includeUrls: false }),
      '[ZoneTransfer]\r\nZoneId=3\r\n',
    );
  });
  it('handles missing URLs', () => assert.equal(formatZoneIdentifier({}), '[ZoneTransfer]\r\nZoneId=3\r\n'));
});

describe('zoneUrl', () => {
  it('strips credentials and fragment', () =>
    assert.equal(zoneUrl('https://user:pw@example.com/f.zip?x=1#frag'), 'https://example.com/f.zip?x=1'));
  it('rejects junk and other schemes', () => {
    assert.equal(zoneUrl('not a url'), null);
    assert.equal(zoneUrl('file:///C:/x.exe'), null);
    assert.equal(zoneUrl(''), null);
    assert.equal(zoneUrl(null), null);
  });
});
