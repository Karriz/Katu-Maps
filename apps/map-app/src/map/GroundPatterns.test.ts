import { describe, expect, it } from 'vitest';
import { generateGroundPattern, groundPatternKinds } from './GroundPatterns';

// Approved 256px textures: scheduling and coverage reuse must preserve pixels.
const expected = {
  "grass-light": "55ae51e6c3a87eff3210b3f625a56de24fff4c2a78068a27b65f879655d4c01f",
  "grass-dark": "db577954b55704f6d9d0daae9895a69f2ed0d0516ee3d5f16a2f61918523fe0c",
  "park-light": "8c29fdbe269de36da13b842d9e1d0c603f55394a02d1c9c12eb43581e3fdc75d",
  "park-dark": "a483ba5f6ea4d3f049ff3bc21d95556b45dcb191c1145da3e5e979429c3ffc88",
  "forest-light": "8f2dbf1f3f3d70789008e92042252a8b0d80d59cb68180c89f649a642797684c",
  "forest-dark": "ceb057e9f3b620936ed0f29e3f5f55170316d262758f858583eac903f466bd08",
  "scrub-light": "0ee40a0ae3d550c59ebf9492f803f038f1a63f76c6e41ec7dd29d2ae52548824",
  "scrub-dark": "779c3678396025fedb8627f022b61466d80194ff3033dcb48afe38d57849b2d2",
  "meadow-light": "e4aefee58e5a0de35b4780a9ba83e788d0f7070365a1d763122e32d7723aaff6",
  "meadow-dark": "0cb313531a782c7192432af147a5f276aecc2419f163d4c5ea7cfe5c2d7a2eb4",
  "wetland-light": "40f3f5cfead68f489f4cb37aaf05b8b0df4c3aff452b203c08b68ea96bbb231a",
  "wetland-dark": "633c86bbb0bfbd1f25a3c6c6b7312b2c12067dbba91fafd882e719ab40997ddf",
  "sand-light": "bac756a790e7b0877b103a679d9e7f427b84cf47b76f9721069b5486e124378a",
  "sand-dark": "82be32d2ac644275ce3411bfdb019b63b87375bc8d044c11de35a3d1039cf8da",
  "rock-light": "1c1cfb241a333bff04543df7e3648e9fab13ecc27849aacf41e00d1545748887",
  "rock-dark": "33ef281646241330c017b0b94f0072269901520685a09a1fec6a8fb7eb17248d",
  "farmland-light": "903acb67a78c3a71d6191f42d94050a4e3978ec118b8cc34db94378b26d54900",
  "farmland-dark": "229449689a9c7210d19b5d800bef7086f569689c5a18a312d7fc8d6234dd1640"
} as Record<string, string>;

describe('ground pattern generation', () => {
  it('preserves both palettes while sharing coverage and yielding between rows', async () => {
    const cache = new Map();
    for (const kind of groundPatternKinds()) {
      let coverage: Float64Array | undefined;
      for (const theme of ['light', 'dark'] as const) {
        const job = generateGroundPattern(256, kind, theme, cache);
        let result = job.next();
        let yields = 0;
        while (!result.done) { yields += 1; result = job.next(); }
        expect(yields).toBeGreaterThanOrEqual(256);
        const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(result.value.data));
        const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
        expect(hash).toBe(expected[`${kind}-${theme}`]);
        if (coverage) expect(cache.get(kind)).toBe(coverage);
        coverage = cache.get(kind);
      }
    }
  });
});
