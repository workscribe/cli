import { describe, it, expect } from 'vitest'
import { MAX_HEADER_NAME_WORD_LENGTH, redact } from '../../src/capture/redact'

// Well above what these take, about 2 s at worst, so a loaded machine doesn't fail them
const MAX_REDACT_MS = 5000

describe('redact', () => {
  describe('AWS keys', () => {
    it('redacts AWS access key IDs', () => {
      const cmd = 'aws s3 cp AKIAIOSFODNN7EXAMPLE secret'
      expect(redact(cmd)).toContain('[REDACTED]')
      expect(redact(cmd)).not.toMatch(/AKIA/)
    })

    it('redacts AWS secret via environment variable', () => {
      const cmd = 'export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
      expect(redact(cmd)).toContain('[REDACTED]')
      expect(redact(cmd)).not.toContain('wJalrXUtnFEMI')
    })
  })

  describe('GitHub tokens', () => {
    it('redacts ghp_ tokens', () => {
      const token = 'ghp_' + 'a'.repeat(36)
      expect(redact(`git clone https://${token}@github.com/org/repo`)).toContain('[REDACTED]')
      expect(redact(`git clone https://${token}@github.com/org/repo`)).not.toContain(token)
    })

    it('redacts github_pat_ tokens', () => {
      const token = 'github_pat_' + 'a'.repeat(82)
      expect(redact(`echo ${token}`)).toContain('[REDACTED]')
    })
  })

  describe('JWTs', () => {
    it('redacts JWT tokens', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
      expect(redact(`curl -H "Authorization: Bearer ${jwt}" https://api.example.com`)).toContain('[REDACTED]')
      expect(redact(`curl -H "Authorization: Bearer ${jwt}" https://api.example.com`)).not.toContain('eyJhbGci')
    })
  })

  describe('Slack tokens', () => {
    it('redacts xoxb- bot tokens', () => {
      expect(redact('slack send --token xoxb-123-456-abc')).toContain('[REDACTED]')
    })

    it('redacts xoxp- user tokens', () => {
      expect(redact('echo xoxp-111-222-333-secret')).toContain('[REDACTED]')
    })

    it('redacts Slack incoming webhook URLs', () => {
      const url = 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX'
      const result = redact(`curl -X POST ${url} -d '{"text":"test"}'`)
      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain('hooks.slack.com')
    })

    it('leaves non-Slack URLs untouched', () => {
      const cmd = 'curl https://api.example.com/webhook'
      expect(redact(cmd)).toBe(cmd)
    })
  })

  describe('Stripe keys', () => {
    it('redacts live stripe keys', () => {
      expect(redact('stripe charges create sk_live_' + 'x'.repeat(24))).toContain('[REDACTED]')
    })

    it('redacts test stripe keys', () => {
      expect(redact('echo sk_test_' + 'x'.repeat(24))).toContain('[REDACTED]')
    })
  })

  describe('flag-based secrets', () => {
    it('redacts --password flag values', () => {
      const result = redact('psql --password mysecretpassword -U admin')
      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain('mysecretpassword')
    })

    it('redacts --secret flag values', () => {
      const result = redact('app deploy --secret topsecretvalue')
      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain('topsecretvalue')
    })

    it('redacts --token flag values', () => {
      const result = redact('cli login --token abc123xyz')
      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain('abc123xyz')
    })

    it('redacts --key flag values', () => {
      const result = redact('tool --key myprivatekey')
      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain('myprivatekey')
    })
  })

  describe('export statements', () => {
    it('redacts exported API_KEY values', () => {
      const result = redact('export API_KEY=supersecret123')
      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain('supersecret123')
    })

    it('redacts exported TOKEN values', () => {
      const result = redact('export AUTH_TOKEN=bearer-abc-def')
      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain('bearer-abc-def')
    })

    it('redacts exported PASSWORD values', () => {
      const result = redact('export DB_PASSWORD=hunter2')
      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain('hunter2')
    })

    it('does NOT redact benign export statements', () => {
      const result = redact('export NODE_ENV=production')
      expect(result).toBe('export NODE_ENV=production')
    })

    it('does NOT redact exported PATH', () => {
      const result = redact('export PATH=/usr/local/bin:$PATH')
      expect(result).toBe('export PATH=/usr/local/bin:$PATH')
    })
  })

  describe('inline env var assignments', () => {
    it('redacts API_KEY=value before a command', () => {
      const result = redact('API_KEY=super_secret_value npm start')
      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain('super_secret_value')
      expect(result).toContain('API_KEY=')
    })

    it('redacts AWS_SECRET_ACCESS_KEY=value inline', () => {
      const result = redact('AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI curl https://api.example.com')
      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain('wJalrXUtnFEMI')
    })

    it('redacts AUTH_TOKEN=value inline', () => {
      const result = redact('AUTH_TOKEN=abc123 npm run deploy')
      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain('abc123')
      expect(result).toContain('AUTH_TOKEN=')
    })

    it('redacts DB_PASSWORD=value inline', () => {
      const result = redact('DB_PASSWORD=hunter2 psql -U admin mydb')
      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain('hunter2')
    })

    it('does NOT redact benign inline assignments', () => {
      expect(redact('PORT=3000 node app.js')).toBe('PORT=3000 node app.js')
      expect(redact('NODE_ENV=production npm start')).toBe('NODE_ENV=production npm start')
      expect(redact('DEBUG=express:* node app.js')).toBe('DEBUG=express:* node app.js')
    })
  })

  describe('connection string URL credentials', () => {
    it('redacts password in postgres DATABASE_URL', () => {
      const result = redact('DATABASE_URL=postgres://user:hunter2@db-host/mydb npm run migrate')
      expect(result).not.toContain('hunter2')
      expect(result).toContain('postgres://user:[REDACTED]@db-host/mydb')
    })

    it('redacts password in mongodb MONGO_URI', () => {
      const result = redact('MONGO_URI=mongodb://admin:s3cr3t@mongo:27017/mydb node app.js')
      expect(result).not.toContain('s3cr3t')
      expect(result).toContain('mongodb://admin:[REDACTED]@mongo:27017/mydb')
    })

    it('redacts password in redis REDIS_URL', () => {
      const result = redact('REDIS_URL=redis://user:cachepass@redis:6379 npm start')
      expect(result).not.toContain('cachepass')
      expect(result).toContain('redis://user:[REDACTED]@redis:6379')
    })

    it('redacts password in exported DATABASE_URL', () => {
      const result = redact('export DATABASE_URL=postgres://app:dbpass@prod-host/appdb')
      expect(result).not.toContain('dbpass')
      expect(result).toContain('postgres://app:[REDACTED]@prod-host/appdb')
    })

    it('redacts token used as password in git remote URL', () => {
      const result = redact('git push https://user:ghp_token123@github.com/org/repo')
      expect(result).not.toContain('ghp_token123')
    })

    it('does NOT redact URLs without embedded credentials', () => {
      expect(redact('curl https://api.example.com/v1/data')).toBe('curl https://api.example.com/v1/data')
      expect(redact('git clone https://github.com/org/repo')).toBe('git clone https://github.com/org/repo')
      expect(redact('export REPO_URL=https://github.com/org/repo')).toBe('export REPO_URL=https://github.com/org/repo')
    })
  })

  describe('safe commands', () => {
    it('leaves normal git commands untouched', () => {
      const cmd = 'git commit -m "fix: auth bug"'
      expect(redact(cmd)).toBe(cmd)
    })

    it('leaves npm install untouched', () => {
      const cmd = 'npm install axios'
      expect(redact(cmd)).toBe(cmd)
    })

    it('leaves docker commands untouched', () => {
      const cmd = 'docker build -t myapp .'
      expect(redact(cmd)).toBe(cmd)
    })
  })

  describe('multiple secrets in one command', () => {
    it('redacts all occurrences', () => {
      const awsKey = 'AKIAIOSFODNN7EXAMPLE'
      const ghToken = 'ghp_' + 'b'.repeat(36)
      const cmd = `deploy --key ${awsKey} --token ${ghToken}`
      const result = redact(cmd)
      expect(result).not.toContain(awsKey)
      expect(result).not.toContain(ghToken)
    })
  })

  describe('extra patterns', () => {
    it('applies custom regex patterns', () => {
      const result = redact('connect mydb://user:MYSECRET@host', ['MYSECRET'])
      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain('MYSECRET')
    })

    it('silently ignores invalid regex patterns', () => {
      expect(() => redact('git status', ['[invalid'])).not.toThrow()
    })

    it('still applies builtin patterns when extras are invalid', () => {
      const token = 'ghp_' + 'c'.repeat(36)
      const result = redact(`echo ${token}`, ['[invalid'])
      expect(result).toContain('[REDACTED]')
    })
  })

  describe('secrets in common command forms', () => {
    it.each([
      ['mysql -u root -pFAKEVALUE', 'mysql -u root -p[REDACTED]'],
      ['mysql -uroot -pFAKEVALUE db', 'mysql -uroot -p[REDACTED] db'],
      ['mysqldump -pFAKEVALUE db', 'mysqldump -p[REDACTED] db'],
      ['mysqladmin -u root -pFAKEVALUE ping', 'mysqladmin -u root -p[REDACTED] ping'],
      ['mariadb -pFAKEVALUE', 'mariadb -p[REDACTED]'],
      ["mysql -p'FAKE VALUE' db", 'mysql -p[REDACTED] db'],
      ['mysql --password=FAKEVALUE', 'mysql --password=[REDACTED]'],
      ['sshpass -p FAKEVALUE ssh host', 'sshpass -p [REDACTED] ssh host'],
      ['sshpass -pFAKEVALUE ssh host', 'sshpass -p[REDACTED] ssh host'],
      ['redis-cli -a FAKEVALUE ping', 'redis-cli -a [REDACTED] ping'],
      ['docker login -u me -p FAKEVALUE', 'docker login -u me -p [REDACTED]'],
      ['podman login -p FAKEVALUE', 'podman login -p [REDACTED]'],
      ['mongosh -u me -p FAKEVALUE', 'mongosh -u me -p [REDACTED]'],
      ['ssh-keygen -N FAKEVALUE', 'ssh-keygen -N [REDACTED]'],
      ['unzip -P FAKEVALUE a.zip', 'unzip -P [REDACTED] a.zip'],
      ['zip -P FAKEVALUE a.zip b', 'zip -P [REDACTED] a.zip b'],
      ['openssl enc -pass pass:FAKEVALUE', 'openssl enc -pass pass:[REDACTED]'],
      ['curl -u me:FAKEVALUE https://x.io', 'curl -u me:[REDACTED] https://x.io'],
      ['curl --user me:FAKEVALUE https://x.io', 'curl --user me:[REDACTED] https://x.io'],
      ['curl -H "Authorization: Bearer FAKEVALUE1" x.io', 'curl -H "Authorization: Bearer [REDACTED]" x.io'],
      ['curl -H "Authorization: Basic FAKEVALUE" x.io', 'curl -H "Authorization: Basic [REDACTED]" x.io'],
      ["curl -H 'X-Api-Key: FAKEVALUE' x.io", "curl -H 'X-Api-Key: [REDACTED]' x.io"],
      ['curl -H "Cookie: session=FAKEVALUE" x.io', 'curl -H "Cookie: [REDACTED]" x.io'],
      ['run --token=FAKEVALUE', 'run --token=[REDACTED]'],
      ['run --api-key=FAKEVALUE', 'run --api-key=[REDACTED]'],
      ['run --client-secret FAKEVALUE', 'run --client-secret [REDACTED]'],
      ['run --access-token FAKEVALUE', 'run --access-token [REDACTED]'],
      ['run --pass FAKEVALUE', 'run --pass [REDACTED]'],
      ['run --pwd FAKEVALUE', 'run --pwd [REDACTED]'],
      ['run --password "FAKE VALUE" now', 'run --password [REDACTED] now'],
      ['git clone https://FAKEVALUE@github.com/a/b', 'git clone https://[REDACTED]@github.com/a/b'],
      ['npm config set //r.io/:_password FAKEVALUE', 'npm config set //r.io/:_password [REDACTED]'],
      ['psql "host=x password=FAKEVALUE"', 'psql "host=x password=[REDACTED]"'],
      ['MYSQL_PWD=FAKEVALUE mysql', 'MYSQL_PWD=[REDACTED] mysql'],
      ['export DB_PWD=FAKEVALUE', 'export DB_PWD=[REDACTED]'],
      [
        'kubectl create secret generic s --from-literal=password=FAKEVALUE',
        'kubectl create secret generic s --from-literal=password=[REDACTED]',
      ],
      ['gh auth login --with-token <<< FAKEVALUE', 'gh auth login --with-token <<< [REDACTED]'],
      ['echo FAKEVALUE | docker login --password-stdin', 'echo [REDACTED] | docker login --password-stdin'],
      ['echo -n FAKEVALUE | docker login --password-stdin', 'echo -n [REDACTED] | docker login --password-stdin'],
      ['printf "%s" FAKEVALUE | gh auth login --with-token', 'printf "%s" [REDACTED] | gh auth login --with-token'],
      ['printf FAKEVALUE | docker login --password-stdin', 'printf [REDACTED] | docker login --password-stdin'],
      ['curl -u "me:FAKE VALUE" x.io', 'curl -u "me:[REDACTED]" x.io'],
      ["curl -u 'me:FAKE VALUE' x.io", "curl -u 'me:[REDACTED]' x.io"],
      ['curl -ume:FAKEVALUE x.io', 'curl -ume:[REDACTED] x.io'],
      ['curl --user=me:FAKEVALUE x.io', 'curl --user=me:[REDACTED] x.io'],
      ['run --password -FAKEVALUE', 'run --password [REDACTED]'],
      ['run --password=-FAKEVALUE', 'run --password=[REDACTED]'],
      ['curl -H X-Api-Key:FAKEVALUE x.io && git push', 'curl -H X-Api-Key:[REDACTED] x.io && git push'],
      ['curl --header=Cookie:FAKEVALUE x.io', 'curl --header=Cookie:[REDACTED] x.io'],
      ['cd a && mysql -pFAKEVALUE', 'cd a && mysql -p[REDACTED]'],
      ['(mysql -pFAKEVALUE)', '(mysql -p[REDACTED])'],
      ['sudo mysql -pFAKEVALUE', 'sudo mysql -p[REDACTED]'],
      ['sudo -u root mysql -pFAKEVALUE', 'sudo -u root mysql -p[REDACTED]'],
      ['DB_HOST=x mysql -pFAKEVALUE', 'DB_HOST=x mysql -p[REDACTED]'],
      ['/usr/local/bin/mysql -pFAKEVALUE', '/usr/local/bin/mysql -p[REDACTED]'],
      ['docker exec -it db mysql -uroot -pFAKEVALUE', 'docker exec -it db mysql -uroot -p[REDACTED]'],
      ['docker compose exec db redis-cli -a FAKEVALUE', 'docker compose exec db redis-cli -a [REDACTED]'],
      ['kubectl exec pod -c main -- mongosh -p FAKEVALUE', 'kubectl exec pod -c main -- mongosh -p [REDACTED]'],
      ['bash -c "mysql -pFAKEVALUE"', 'bash -c "mysql -p[REDACTED]"'],
      ["ssh host 'mysql -pFAKEVALUE'", "ssh host 'mysql -p[REDACTED]'"],
      ['sudo docker login -p FAKEVALUE', 'sudo docker login -p [REDACTED]'],
      ['docker --config /c login -u me -p FAKEVALUE', 'docker --config /c login -u me -p [REDACTED]'],
      ['helm registry login x.io -p FAKEVALUE', 'helm registry login x.io -p [REDACTED]'],
      ['docker --debug login -p FAKEVALUE', 'docker --debug login -p [REDACTED]'],
      ['docker -H tcp://x login -p FAKEVALUE', 'docker -H tcp://x login -p [REDACTED]'],
      ['docker run --rm -it mysql mysql -uroot -pFAKEVALUE', 'docker run --rm -it mysql mysql -uroot -p[REDACTED]'],
      ['docker-compose exec db mysql -pFAKEVALUE', 'docker-compose exec db mysql -p[REDACTED]'],
      ['kubectl -n prod exec pod -- mysql -pFAKEVALUE', 'kubectl -n prod exec pod -- mysql -p[REDACTED]'],
      ['docker --context x exec db mysql -pFAKEVALUE', 'docker --context x exec db mysql -p[REDACTED]'],
      ['ssh db01 mysql -pFAKEVALUE', 'ssh db01 mysql -p[REDACTED]'],
      ['ssh db01 redis-cli -a FAKEVALUE', 'ssh db01 redis-cli -a [REDACTED]'],
      ['if true; then mysql -pFAKEVALUE; fi', 'if true; then mysql -p[REDACTED]; fi'],
      ['for db in a; do mysqldump -pFAKEVALUE; done', 'for db in a; do mysqldump -p[REDACTED]; done'],
      ['{ mysql -pFAKEVALUE; }', '{ mysql -p[REDACTED]; }'],
      ['! mysql -pFAKEVALUE', '! mysql -p[REDACTED]'],
      ['timeout 30 mysql -pFAKEVALUE', 'timeout 30 mysql -p[REDACTED]'],
      ['/usr/bin/env mysql -pFAKEVALUE', '/usr/bin/env mysql -p[REDACTED]'],
      ['eval "mysql -pFAKEVALUE"', 'eval "mysql -p[REDACTED]"'],
      ['su -c "mysql -pFAKEVALUE"', 'su -c "mysql -p[REDACTED]"'],
      ['watch "mysql -pFAKEVALUE"', 'watch "mysql -p[REDACTED]"'],
      ['"/opt/bin/mysql" -pFAKEVALUE', '"/opt/bin/mysql" -p[REDACTED]'],
      ['run a; $(mysql -pFAKEVALUE)', 'run a; $(mysql -p[REDACTED])'],
      ['mongosh -p 12345', 'mongosh -p [REDACTED]'],
      ['curl -sH "X-Api-Key: FAKEVALUE" x.io', 'curl -sH "X-Api-Key: [REDACTED]" x.io'],
      ['curl -sSLH "Cookie: a=FAKEVALUE" x.io', 'curl -sSLH "Cookie: [REDACTED]" x.io'],
      ['curl --proxy-header "Cookie: FAKEVALUE" x.io', 'curl --proxy-header "Cookie: [REDACTED]" x.io'],
      ['http x.io X-Api-Key:FAKEVALUE', 'http x.io X-Api-Key:[REDACTED]'],
      ['HDR="X-Api-Key: FAKEVALUE"; curl -H "$HDR" x.io', 'HDR="X-Api-Key: [REDACTED]"; curl -H "$HDR" x.io'],
      ['curl -su me:FAKEVALUE x.io', 'curl -su me:[REDACTED] x.io'],
      ['run --key=12345678', 'run --key=[REDACTED]'],
      ["curl -d 'it'\\''s' -u me:FAKEVALUE", "curl -d 'it'\\''s' -u me:[REDACTED]"],
      ['curl -d "{\\"m\\":\\"it\'s\\"}" -u me:FAKEVALUE', 'curl -d "{\\"m\\":\\"it\'s\\"}" -u me:[REDACTED]'],
      ["mysql -u o\\'brien -pFAKEVALUE", "mysql -u o\\'brien -p[REDACTED]"],
      ["docker login -u o\\'brien -p FAKEVALUE", "docker login -u o\\'brien -p [REDACTED]"],
      ['mysql -e "say \\" hi" -pFAKEVALUE', 'mysql -e "say \\" hi" -p[REDACTED]'],
      [`curl -d "${'x'.repeat(4100)}" -u me:FAKEVALUE`, `curl -d "${'x'.repeat(4100)}" -u me:[REDACTED]`],
      ['http x.io "Cookie: FAKEVALUE"', 'http x.io "Cookie: [REDACTED]"'],
      ['xh x.io "api-key: FAKEVALUE"', 'xh x.io "api-key: [REDACTED]"'],
      ['echo "Cookie: FAKEVALUE" > h.txt', 'echo "Cookie: [REDACTED]" > h.txt'],
      ['$(which mysql) -pFAKEVALUE', '$(which mysql) -p[REDACTED]'],
      ['`which mysql` -pFAKEVALUE', '`which mysql` -p[REDACTED]'],
      ['TOKEN=FAKEVALUE npm start', 'TOKEN=[REDACTED] npm start'],
      ['PASSWORD="FAKE VALUE" npm start', 'PASSWORD=[REDACTED] npm start'],
      ['curl "x.io?token=FAKEVALUE&a=1"', 'curl "x.io?token=[REDACTED]&a=1"'],
      ['curl "x.io?a=1&key=FAKEVALUE"', 'curl "x.io?a=1&key=[REDACTED]"'],
      ['curl "x.io?client_secret=FAKEVALUE"', 'curl "x.io?client_secret=[REDACTED]"'],
      [`curl -d '{"password":"FAKEVALUE"}' x.io`, `curl -d '{"password":"[REDACTED]"}' x.io`],
      ['curl -d "{\\"api_key\\": \\"FAKEVALUE\\"}" x.io', 'curl -d "{\\"api_key\\": \\"[REDACTED]\\"}" x.io'],
      ['redis-cli -u redis://:FAKEVALUE@h', 'redis-cli -u redis://:[REDACTED]@h'],
      ['curl --cookie s=FAKEVALUE x.io', 'curl --cookie [REDACTED] x.io'],
      ['curl -sb "s=FAKEVALUE" x.io', 'curl -sb [REDACTED] x.io'],
      ['curl -H "Authorization: FAKEVALUE" x.io', 'curl -H "Authorization: [REDACTED]" x.io'],
      ['curl -H "Authorization: ApiKey FAKEVALUE" x.io', 'curl -H "Authorization: [REDACTED]" x.io'],
      ['mariadb-admin -pFAKEVALUE', 'mariadb-admin -p[REDACTED]'],
      ['mariadb-check -pFAKEVALUE', 'mariadb-check -p[REDACTED]'],
      ['mysql.exe -pFAKEVALUE', 'mysql.exe -p[REDACTED]'],
      ['"C:/bin/mysql.exe" -pFAKEVALUE', '"C:/bin/mysql.exe" -p[REDACTED]'],
      ['docker run --entrypoint=mysql img -pFAKEVALUE', 'docker run --entrypoint=mysql img -p[REDACTED]'],
      ['podman-remote login -p FAKEVALUE', 'podman-remote login -p [REDACTED]'],
      ['"docker" login -p FAKEVALUE', '"docker" login -p [REDACTED]'],
      ['docker login -pFAKEVALUE', 'docker login -p[REDACTED]'],
      ['unzip -PFAKEVALUE a.zip', 'unzip -P[REDACTED] a.zip'],
      ['ssh-keygen -NFAKEVALUE', 'ssh-keygen -N[REDACTED]'],
      ['redis-cli -aFAKEVALUE', 'redis-cli -a[REDACTED]'],
      ['mongodump -p FAKEVALUE', 'mongodump -p [REDACTED]'],
      ['screen -dm "mysql -pFAKEVALUE"', 'screen -dm "mysql -p[REDACTED]"'],
      ['curl -u me:"FAKE VALUE" x.io', 'curl -u me:[REDACTED] x.io'],
      ['curl https://x.io \\\n  -u me:FAKEVALUE', 'curl https://x.io \\\n  -u me:[REDACTED]'],
      ['mysql -u root \\\n  -pFAKEVALUE', 'mysql -u root \\\n  -p[REDACTED]'],
      ['docker login \\\n  -p FAKEVALUE', 'docker login \\\n  -p [REDACTED]'],
      ['curl "https://x.io/a?b=1&c=2" -u me:FAKEVALUE', 'curl "https://x.io/a?b=1&c=2" -u me:[REDACTED]'],
      ['mysql -e "select 1; select 2" -pFAKEVALUE', 'mysql -e "select 1; select 2" -p[REDACTED]'],
      [`curl -d "${'x'.repeat(600)}" -u me:FAKEVALUE`, `curl -d "${'x'.repeat(600)}" -u me:[REDACTED]`],
      [`mysql ${'--opt '.repeat(120)}-pFAKEVALUE`, `mysql ${'--opt '.repeat(120)}-p[REDACTED]`],
      [`docker ${'--opt '.repeat(30)}login -p FAKEVALUE`, `docker ${'--opt '.repeat(30)}login -p [REDACTED]`],
      ['http x.io Cookie:FAKEVALUE', 'http x.io Cookie:[REDACTED]'],
      ['xh x.io api-key:FAKEVALUE', 'xh x.io api-key:[REDACTED]'],
      ['HDR="Cookie: FAKEVALUE"; curl -H "$HDR" x.io', 'HDR="Cookie: [REDACTED]"; curl -H "$HDR" x.io'],
      ['gpg --passphrase FAKEVALUE', 'gpg --passphrase [REDACTED]'],
      ['kubectl --docker-password=FAKEVALUE', 'kubectl --docker-password=[REDACTED]'],
      ['wget --http-password FAKEVALUE x.io', 'wget --http-password [REDACTED] x.io'],
      ['helm install a --set db.password=FAKEVALUE', 'helm install a --set db.password=[REDACTED]'],
      ['export DB_PASSWORD="FAKE VALUE"', 'export DB_PASSWORD=[REDACTED]'],
      ["API_KEY='FAKE VALUE' npm start", 'API_KEY=[REDACTED] npm start'],
      ['run --key ab/cd.ef', 'run --key [REDACTED]'],
    ])('%s', (command, expected) => {
      expect(redact(command)).toBe(expected)
      // The scrub-secrets job checks a row is clean by redacting it again
      expect(redact(expected)).toBe(expected)
    })

    it('redacts a whole private key block', () => {
      const block = '-----BEGIN RSA PRIVATE KEY-----\nFAKEVALUE\n-----END RSA PRIVATE KEY-----'
      expect(redact(`cat > key.pem <<EOF\n${block}\nEOF`)).toBe('cat > key.pem <<EOF\n[REDACTED]\nEOF')
    })

    it.each([
      ['Anthropic', 'sk-ant-api03-' + 'a'.repeat(30)],
      ['OpenAI', 'sk-proj-' + 'a'.repeat(30)],
      ['Google', 'AIza' + 'a'.repeat(35)],
      ['npm', 'npm_' + 'a'.repeat(36)],
      ['GitHub OAuth', 'gho_' + 'a'.repeat(36)],
      ['UUID-shaped', 'sk-1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d'],
      ['prefixed and UUID-shaped', 'sk-lf-1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d'],
      ['dashed, with short runs', 'sk-Ab3d-Ef6h-Ij9l-Mn2p-Qr5t-Uv8x'],
    ])('redacts %s keys', (_provider, key) => {
      expect(redact(`deploy ${key} now`)).toBe('deploy [REDACTED] now')
    })
  })

  describe('leaves ordinary commands alone', () => {
    it.each([
      'mkdir -p src/ui',
      'cp -p a b',
      'ls -p src',
      'grep -p x f',
      'tar -pxf a.tar',
      'npm install -P lodash',
      'ssh -p 2222 host',
      'psql -p 5432 db',
      'docker run -p 3000:3000 img',
      'git log -p',
      'mysql -p db',
      'mongosh -p --tls',
      'docker login --password-stdin -u me',
      'gh auth login --with-token',
      'task-list-item',
      'git clone git@github.com:a/b.git',
      'curl https://example.com/a',
      'git push origin main',
      'cd "$PWD/app"',
      'docker run -d --name mongo -p 27017:27017 mongo:7',
      'sudo docker run --name mongo -p 27017:27017 mongo:7',
      'docker run --name login-service -p 3000:3000 img',
      'docker compose -f docker-compose.login.yml -p myproj up',
      'scp a.zip host:/tmp -P 2222',
      'ssh mongo -p 2222',
      'docker run --name=mongo -p 27017 img',
      'docker run mongo -p 127.0.0.1:27017:27017/tcp',
      'git commit -m "cookie: rotate on login"',
      'git checkout -b sk-fix-the-login-redirect-bug',
      'curl https://x.io?email=a@b.com',
      'sort --key=2 names.txt',
      'sort --key 2,3 names.txt',
      'nginx --key=certs/server.key',
      'ssh-add --key ~/.ssh/id_ed25519',
      'psql --no-password db',
      'git log --author=me',
      'gh api -f key=value',
      'curl "x.io?page=2&sort=name"',
      'gh pr create --title "cookie: rotate on login"',
    ])('%s', (command) => {
      expect(redact(command)).toBe(command)
    })
  })

  describe('keeps the rest of a compound command', () => {
    it.each([
      [
        'git commit -m "add --pass option" && git switch -c feat/x',
        'git commit -m "add --pass [REDACTED]" && git switch -c feat/x',
      ],
      ['git commit -m "use --pass=x"; git push', 'git commit -m "use --pass=[REDACTED]"; git push'],
      ['git commit -m "support mongo -p flag" && git push', 'git commit -m "support mongo -p flag" && git push'],
      ['mysql -pFAKEVALUE; git switch -c feat/x', 'mysql -p[REDACTED]; git switch -c feat/x'],
      ['export API_KEY=FAKEVALUE; git switch -c feat/x', 'export API_KEY=[REDACTED]; git switch -c feat/x'],
      [
        'git commit -m "set API_KEY=x" && git switch -c feat/x',
        'git commit -m "set API_KEY=[REDACTED]" && git switch -c feat/x',
      ],
      ['mysql -pFAKEVALUE&& git push', 'mysql -p[REDACTED]&& git push'],
      ['run --password=a&b now', 'run --password=[REDACTED] now'],
    ])('%s', (command, expected) => {
      expect(redact(command)).toBe(expected)
    })

    it('still takes a value with a quote inside it', () => {
      expect(redact(`run --password ab'c"d now`)).toBe('run --password [REDACTED] now')
    })
  })

  describe('more tools, flags and headers', () => {
    it.each([
      ['mysql@8 -pFAKEVALUE', 'mysql@8 -p[REDACTED]'],
      ['mycli -pFAKEVALUE', 'mycli -p[REDACTED]'],
      ['mysqlsh -u me -pFAKEVALUE', 'mysqlsh -u me -p[REDACTED]'],
      ['7z a -pFAKEVALUE out.7z dir', '7z a -p[REDACTED] out.7z dir'],
      ['7za x -pFAKEVALUE out.7z', '7za x -p[REDACTED] out.7z'],
      ['http -a me:FAKEVALUE x.io', 'http -a me:[REDACTED] x.io'],
      ['http --auth me:FAKEVALUE x.io', 'http --auth me:[REDACTED] x.io'],
      ['xh -a "me:FAKEVALUE" x.io', 'xh -a "me:[REDACTED]" x.io'],
      ['openssl enc -aes-256-cbc -k FAKEVALUE -in f', 'openssl enc -aes-256-cbc -k [REDACTED] -in f'],
      ['openssl enc -pass "pass:FAKEVALUE" -in f', 'openssl enc -pass "pass:[REDACTED]" -in f'],
      ["openssl enc -pass 'pass:FAKEVALUE' -in f", "openssl enc -pass 'pass:[REDACTED]' -in f"],
      ['gh secret set NAME --body FAKEVALUE', 'gh secret set NAME --body [REDACTED]'],
      ['gh secret set NAME -b "FAKEVALUE" --repo o/r', 'gh secret set NAME -b [REDACTED] --repo o/r'],
      [
        'kubectl create secret generic s --from-literal=token=FAKEVALUE',
        'kubectl create secret generic s --from-literal=token=[REDACTED]',
      ],
      [
        'kubectl create secret generic s --from-literal=db_password=FAKEVALUE --from-literal=user=me',
        'kubectl create secret generic s --from-literal=db_password=[REDACTED] --from-literal=user=[REDACTED]',
      ],
      ['curl -H "PRIVATE-TOKEN: FAKEVALUE" x.io', 'curl -H "PRIVATE-TOKEN: [REDACTED]" x.io'],
      ['curl -H "X-Token: FAKEVALUE" x.io', 'curl -H "X-Token: [REDACTED]" x.io'],
    ])('redacts %s', (command, expected) => {
      expect(redact(command)).toBe(expected)
    })

    it('redacts a versioned tool run by its full path', () => {
      expect(redact('/opt/homebrew/opt/mysql@8.0/bin/mysql@8.0 -u me -pFAKEVALUE db')).not.toContain('FAKEVALUE')
    })

    it.each([
      'mysql@8 -p db',
      '7z a out.7z dir',
      '7z x -y out.7z',
      'http x.io',
      'http -a',
      'openssl x509 -in cert.pem -noout',
      'openssl enc -in f -out g',
      'gh secret set NAME < value.txt',
      'gh secret list --body',
      'curl -H "Accept: text/plain" x.io',
    ])('leaves %s alone', (command) => {
      expect(redact(command)).toBe(command)
    })
  })

  describe('a secret that holds a ;', () => {
    it.each([
      ['export PASSWORD=ab;cd', 'export PASSWORD=[REDACTED]'],
      ['mysql --password=pa;ss -h x', 'mysql --password=[REDACTED] -h x'],
      ['TOKEN=ab;cd npm publish', 'TOKEN=[REDACTED] npm publish'],
      ['note: rotated --token=ab;cd today', 'note: rotated --token=[REDACTED] today'],
    ])('redacts all of it in %s', (command, expected) => {
      expect(redact(command)).toBe(expected)
    })
  })

  describe('quotes that do not pair up cannot hide a quoted secret', () => {
    it.each([
      `echo it's --password "FAKEVALUE" y's`,
      `echo \\" --password "FAKEVALUE" \\"`,
      `it's a "note": --password "FAKEVALUE" and don't`,
      `"a" it's --password "FAKEVALUE" 'b' it's`,
      `don't --password "FAKEVALUE" "isn't" it's`,
    ])('redacts the value in %s', (text) => {
      expect(redact(text)).not.toContain('FAKEVALUE')
    })
  })

  describe('keeps the branch move in a compound command', () => {
    it.each([
      ['echo "use mongo -p" && git switch -c x && echo "y"', 'echo "use mongo -p" && git switch -c x && echo "y"'],
      [
        `git commit -m "don't use mongo -p" && git switch -c x && git commit -m "b"`,
        `git commit -m "don't use mongo -p" && git switch -c x && git commit -m "b"`,
      ],
      ['curl -H "Cookie:" x && git switch -c y && echo "z"', 'curl -H "Cookie:" x && git switch -c y && echo "z"'],
      ['mysql -pX;git switch -c y', 'mysql -p[REDACTED];git switch -c y'],
      [
        'mysql -pX;git switch -c y;mysql -pY&& git push',
        'mysql -p[REDACTED];git switch -c y;mysql -p[REDACTED]&& git push',
      ],
    ])('keeps the rest of %s', (command, expected) => {
      expect(redact(command)).toBe(expected)
    })

    it('still redacts a value in quotes that start after a flag inside another string', () => {
      expect(redact('bash -c "mongosh -p" && mongosh -p "SECRET" && git switch -c y')).toBe(
        'bash -c "mongosh -p" && mongosh -p [REDACTED] && git switch -c y'
      )
    })

    it('still redacts when quotes do not pair up, as in prose with an apostrophe', () => {
      expect(redact(`don't log --password "hunter2" here`)).toBe(`don't log --password [REDACTED] here`)
    })

    it('still redacts a quoted value with a space in it', () => {
      expect(redact('run --password "a b" now')).toBe('run --password [REDACTED] now')
    })

    it('does not skip an extra pattern that starts with a quote', () => {
      expect(redact('echo "x" "secret-thing"', ['"secret-thing"'])).toBe('echo "x" [REDACTED]')
    })
  })

  describe('a credential assigned in code', () => {
    const KEY = `lin_api_${'A1b2C3d4'.repeat(5)}`

    it.each([
      [`node -e "const API_KEY = '${KEY}'"`, `node -e "const API_KEY = '[REDACTED]'"`],
      [`node -e "const apiKey = '${KEY}'; fetch(u)"`, `node -e "const apiKey = '[REDACTED]'; fetch(u)"`],
      [`python3 -c "token = '${KEY}'"`, `python3 -c "token = '[REDACTED]'"`],
      [`node -e 'const api_key: "${KEY}"'`, `node -e 'const api_key: "[REDACTED]"'`],
      [
        `node -e "const headers = { Authorization: '${KEY}' }"`,
        `node -e "const headers = { Authorization: '[REDACTED]' }"`,
      ],
      [
        `node -e "const headers = { 'x-api-key': '${KEY}' }"`,
        `node -e "const headers = { 'x-api-key': '[REDACTED]' }"`,
      ],
      [
        `node -e "const client = new Linear({ apiKey: '${KEY}' })"`,
        `node -e "const client = new Linear({ apiKey: '[REDACTED]' })"`,
      ],
      [`node -e "process.env.LINEAR_API_KEY = '${KEY}'"`, `node -e "process.env.LINEAR_API_KEY = '[REDACTED]'"`],
      [`python3 -c "client = Client(secret='${KEY}')"`, `python3 -c "client = Client(secret='[REDACTED]')"`],
      [`python3 -c "password = 'hunter2hunter2'"`, `python3 -c "password = '[REDACTED]'"`],
      [`const secret_key = "FAKEVALUE1234"`, `const secret_key = "[REDACTED]"`],
      [`let accessKey:'FAKEVALUE1234'`, `let accessKey:'[REDACTED]'`],
    ])('redacts the value in %s', (command, expected) => {
      expect(redact(command)).toBe(expected)
    })

    it.each([
      [`node -e "const API_KEY = \\"${KEY}\\""`, `node -e "const API_KEY = \\"[REDACTED]\\""`],
      [
        `node -e "const o = {\\"password\\": \\"hunter2hunter2\\"}"`,
        `node -e "const o = {\\"password\\": \\"[REDACTED]\\"}"`,
      ],
    ])('redacts a value a shell escaped the quotes of: %s', (command, expected) => {
      expect(redact(command)).toBe(expected)
    })

    it('takes a value with spaces whole', () => {
      expect(redact(`node -e "const password = \\"correct horse battery\\""`)).toBe(
        `node -e "const password = \\"[REDACTED]\\""`
      )
    })

    it('redacts a Linear API key wherever it appears', () => {
      expect(redact(`echo ${KEY}`)).toBe('echo [REDACTED]')
    })

    it('redacts a Linear OAuth token wherever it appears', () => {
      expect(redact(`curl https://x.io/?k=lin_oauth_${'a1B2c3D4'.repeat(4)} -s`)).toBe(
        'curl https://x.io/?k=[REDACTED] -s'
      )
    })

    it.each([
      [`node -e "const o = {api_key: 'ab\\'cdefghijk'}"`, `node -e "const o = {api_key: '[REDACTED]'}"`],
      [`node -e "const o = {token: 'quote\\"inside'}"`, `node -e "const o = {token: '[REDACTED]'}"`],
      [`python3 -c 'password = "pa\\"ss word 1"'`, `python3 -c 'password = "[REDACTED]"'`],
    ])('takes a value with an escaped quote in it whole: %s', (command, expected) => {
      expect(redact(command)).toBe(expected)
    })

    it.each([
      [`sqlite3 db "update t set secret='it''s abcdefgh'"`, `sqlite3 db "update t set secret='[REDACTED]'"`],
      [`node -e "const o = {token: 'ab''cd''efghij'}"`, `node -e "const o = {token: '[REDACTED]'}"`],
    ])('takes a value with a doubled quote (the SQL escape) whole: %s', (command, expected) => {
      expect(redact(command)).toBe(expected)
    })

    it('keeps a value just under the minimum length', () => {
      expect(redact(`python3 -c "password = 'hunter7'"`)).toBe(`python3 -c "password = 'hunter7'"`)
      expect(redact(`python3 -c "password = 'hunter78'"`)).toBe(`python3 -c "password = '[REDACTED]'"`)
    })

    it.each([
      [`git commit -m "fix auth: 'invalid credentials' error"`, `git commit -m "fix auth: '[REDACTED]' error"`],
      [`git commit -m "rename token='old value here' handling"`, `git commit -m "rename token='[REDACTED]' handling"`],
    ])('also redacts a quoted phrase of the same shape in prose: %s', (command, expected) => {
      expect(redact(command)).toBe(expected)
    })

    it.each([
      `node -e "const token = getToken()"`,
      `node -e "const token = process.env.TOKEN"`,
      `node -e "const tokens = ['a', 'b']"`,
      `python3 -c "password = input('password: ')"`,
      `node -e "const password = ''"`,
      `node -e "const auth = 'basic'"`,
      `git commit -m "fix: token = 'x' bug"`,
      `node -e "const tokenizer = 'gpt-4o-mini'"`,
      `node -e "const authorName = 'Moe Osaze'"`,
      `node -e "const secretsFile = 'secrets.json'"`,
      `node -e "const keyboard = 'qwerty'"`,
      `node -e "const a = { key: 'name' }"`,
      `node -e "const monkey = 'banana-banana'"`,
      `node -e "const token = '$GITHUB_TOKEN_VALUE'"`,
      `node -e "const apiKey = '<your-api-key-here>'"`,
      `node -e "if (password === 'hunter2hunter2') run()"`,
      `grep -rn "api_key = " src`,
      `echo "set password = prompt"`,
    ])('leaves %s alone', (command) => {
      expect(redact(command)).toBe(command)
    })

    it.each([
      'grep -rn "api_key = " src/capture/redact.ts',
      'grep "api_key = " src "x y z w"',
      'echo "token: " && ls -la /tmp',
      'echo "password = " && cat notes.txt "and more text"',
    ])('does not read the quote that ends a string as the start of a value: %s', (command) => {
      expect(redact(command)).toBe(command)
    })

    it('still redacts a real assignment after a string that has already ended', () => {
      expect(redact(`echo "a" && node -e "const token = 'FAKEVALUE1234'"`)).toBe(
        `echo "a" && node -e "const token = '[REDACTED]'"`
      )
    })

    it('treats text whose quotes do not pair up as having no closing quotes, so it redacts too much rather than too little', () => {
      expect(redact(`echo don't; grep "api_key = " src/capture/redact.ts "x"`)).toContain('[REDACTED]')
    })
  })

  describe('stays fast on a very long line', () => {
    const LONG_LINE_LENGTH = 200_000

    it.each([
      ['short flags', '-p x '],
      ['repeated tool', 'mysql -p x '],
      ['repeated wrapper', 'docker exec mysql -p x '],
      ['repeated curl', 'curl -u a:b '],
      ['repeated pipe', 'echo a | '],
      ['repeated sk-', 'sk-'],
      ['header flags', '-H cookie: '],
      ['bundled header flags', '-sH x-api-key: '],
      ['login without a tool', 'login -p x '],
      ['tool without login', 'docker -p x '],
      ['tool in a message', 'git commit -m "mysql -p x '],
      ['named containers', '--name mysql -p x '],
      ['quoted parts', 'mysql "a" -p x '],
      ['line continuations', 'mysql \\\n -p x '],
      ['hosts after ssh', 'ssh mongo -p 1 '],
      ['unbalanced quotes', "mysql ' -p x "],
      ['long quoted strings', `"${'x'.repeat(10_000)}" -p x `],
      ['assignments in code', `token = 'abc' `],
      ['assignments with long values', `token = '${'x'.repeat(100)}' `],
      ['unterminated assignments', `token = '${'x'.repeat(100)} `],
      ['secret words', 'token '],
      ['one long identifier', `${'token'.repeat(30)}_`],
      ['one long identifier before an operator', `${'token'.repeat(30)}= `],
      ['names with dots and dashes', 'a.b-c.token '],
      ['quotes that end a string before an assignment', `"a" token = "`],
      ['quotes that end a string', 'echo "mongo -p" '],
      ['repeated quoted values', 'mongosh -p "x" '],
      ['repeated 7z', '7z a -p x '],
      ['repeated httpie', 'http -a '],
      ['repeated from-literal', '--from-literal=a-b.c='],
      ['repeated openssl', 'openssl -k '],
      ['repeated gh secret', 'gh secret set A --body '],
      ['repeated versioned tool', 'mysql@8 -p x '],
      ['repeated vault login', 'vault login -x '],
      ['repeated vault login with a pair', 'vault login a=b '],
      ['repeated vault unseal', 'vault operator unseal -x '],
      ['repeated vault kv put', 'vault kv put a=b '],
      ['repeated vault kv put without pairs', 'vault kv put -mount=a '],
      ['repeated ssm put-parameter', 'aws ssm put-parameter --value '],
      ['repeated aws before ssm', 'aws --profile p ssm '],
      ['repeated az login', 'az login -p x '],
      ['repeated az login without a password', 'az login -u x '],
      ['repeated az keyvault', 'az keyvault secret set --value '],
      ['repeated from-literal with a space', '--from-literal a='],
      ['repeated from-literal without a value', '--from-literal a-b.c '],
      ['repeated encrypt_string', "ansible-vault encrypt_string 'a' "],
      ['repeated encrypt_string flags', 'ansible-vault encrypt_string -x '],
      ['repeated gcloud stdin', 'echo a | gcloud secrets '],
      ['repeated creds', '--creds a:b '],
      ['repeated terraform token', 'terraform login -token '],
      ['repeated secret key', 'token=a '],
      ['repeated secret key in quotes', `-var 'secret=a' `],
      ['repeated dashed header name', 'x-a-b-c-d-e-f-g-h-token '],
      ['repeated dashed words', 'a-b-c-d-e-f-g-h-i-j '],
      ['repeated header with a long name', `-H x-${'a'.repeat(MAX_HEADER_NAME_WORD_LENGTH)}-token: `],
      ['curl user with a colon', 'curl -u a: '],
      ['curl user without one', 'curl -u a '],
      ['curl quoted user with a colon', "curl -u 'a:' "],
      ['aws configure set', 'aws configure set aws_session_token '],
      ['aws session token variable', 'AWS_SESSION_TOKEN '],
      ['encrypt_string flags with values', 'ansible-vault encrypt_string --name a '],
      ['encrypt_string value flags only', 'ansible-vault encrypt_string -n a -n '],
      ['secret key after a separator', 'a=1;token=b '],
      ['secret key after an ampersand', 'a=1&pass=b '],
    ])('%s', (_shape, unit) => {
      const longLine = unit.repeat(Math.ceil(LONG_LINE_LENGTH / unit.length))
      const startedAt = performance.now()
      redact(longLine)
      expect(performance.now() - startedAt).toBeLessThan(MAX_REDACT_MS)
    })
  })

  describe('stays fast with a long quoted string before many flags', () => {
    it('stays under the limit', () => {
      const longLine = `"${'x'.repeat(100_000)}"${' -p x'.repeat(20_000)}`
      const startedAt = performance.now()
      redact(longLine)
      expect(performance.now() - startedAt).toBeLessThan(MAX_REDACT_MS)
    })
  })

  describe('leaves prose alone, so a prompt about these topics raises no secret alert', () => {
    it.each([
      'Bearer tokens are sent in the header',
      'add bearer authentication to the API',
      'Authorization: added middleware for it',
      'the password is checked on login',
      'fix the password field and the token refresh',
      'risk-based review of the key rotation',
    ])('%s', (prose) => {
      expect(redact(prose)).toBe(prose)
    })
  })
})
