/**
 * The sentinel address that means "run against the in-process mock".
 *
 * Its own module, with no imports, because two very different callers need it:
 * `registry` (which constructs every backend) and `discovery` (which must not
 * construct any). Leaving it in `registry` meant asking a host what it carries
 * pulled all three backends in behind it.
 */
export const MOCK_HOST = 'mock.local'
