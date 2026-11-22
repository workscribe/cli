import { describe, it, expect } from 'vitest'
import { redact } from '../../src/capture/redact'

// WOR-191: the audit of infrastructure tooling, kept as tests. Every form carries FAKEVALUE where a secret would be.

const FAKE = 'FAKEVALUE'

describe('infrastructure tooling: secrets the audit found leaking', () => {
  it.each([
    // vault
    ['vault login s.FAKEVALUE', 'vault login [REDACTED]'],
    ['vault login hvs.CAESIJFAKEVALUE', 'vault login [REDACTED]'],
    ['vault login -no-print FAKEVALUE', 'vault login -no-print [REDACTED]'],
    ['vault operator unseal FAKEVALUE', 'vault operator unseal [REDACTED]'],
    ['vault kv put secret/app db=FAKEVALUE', 'vault kv put secret/app db=[REDACTED]'],
    ['vault kv put -mount=secret app token=FAKEVALUE', 'vault kv put -mount=secret app token=[REDACTED]'],
    ['vault kv put secret/app db=FAKEVALUE user=bob', 'vault kv put secret/app db=[REDACTED] user=[REDACTED]'],
    ['vault kv patch secret/app db=FAKEVALUE', 'vault kv patch secret/app db=[REDACTED]'],
    [
      'curl -H "X-Vault-Token: s.FAKEVALUE" https://vault.example.com/v1/secret/app',
      'curl -H "X-Vault-Token: [REDACTED]" https://vault.example.com/v1/secret/app',
    ],
    ['curl --header "X-Vault-Token: FAKEVALUE" https://x.io', 'curl --header "X-Vault-Token: [REDACTED]" https://x.io'],
    // aws
    ['aws configure set aws_session_token FwoGZXIvYXdzFAKEVALUE', 'aws configure set aws_session_token [REDACTED]'],
    [
      'aws iam create-access-key --secret-access-key FAKEVALUE',
      'aws iam create-access-key --secret-access-key [REDACTED]',
    ],
    ['aws sts x --session-token FAKEVALUE', 'aws sts x --session-token [REDACTED]'],
    [
      'aws ssm put-parameter --name /app/db --value FAKEVALUE --type SecureString',
      'aws ssm put-parameter --name /app/db --value [REDACTED] --type SecureString',
    ],
    [
      'aws ssm put-parameter --name /app/db --value "FAKE VALUE two" --type SecureString',
      'aws ssm put-parameter --name /app/db --value [REDACTED] --type SecureString',
    ],
    [
      'aws --profile p ssm put-parameter --name /a --value FAKEVALUE --overwrite',
      'aws --profile p ssm put-parameter --name /a --value [REDACTED] --overwrite',
    ],
    [
      'aws secretsmanager create-secret --name x --secret-string FAKEVALUE',
      'aws secretsmanager create-secret --name x --secret-string [REDACTED]',
    ],
    [
      'aws secretsmanager put-secret-value --secret-id x --secret-string FAKEVALUE',
      'aws secretsmanager put-secret-value --secret-id x --secret-string [REDACTED]',
    ],
    [
      'curl -H "X-Amz-Security-Token: FAKEVALUE" https://example.amazonaws.com',
      'curl -H "X-Amz-Security-Token: [REDACTED]" https://example.amazonaws.com',
    ],
    // az and gcloud
    ['az login -u bob -p FAKEVALUE', 'az login -u bob -p [REDACTED]'],
    [
      'az login --service-principal -u appid -p FAKEVALUE --tenant t',
      'az login --service-principal -u appid -p [REDACTED] --tenant t',
    ],
    [
      'az keyvault secret set --vault-name kv --name n --value FAKEVALUE',
      'az keyvault secret set --vault-name kv --name n --value [REDACTED]',
    ],
    [
      'echo FAKEVALUE | gcloud secrets versions add x --data-file=-',
      'echo [REDACTED] | gcloud secrets versions add x --data-file=-',
    ],
    [
      'printf FAKEVALUE | gcloud secrets create x --data-file=-',
      'printf [REDACTED] | gcloud secrets create x --data-file=-',
    ],
    // terraform and tofu
    ["terraform apply -var 'token=FAKEVALUE'", "terraform apply -var 'token=[REDACTED]'"],
    [
      `terraform plan -var "secret=FAKEVALUE" -var 'region=us-east-1'`,
      `terraform plan -var "secret=[REDACTED]" -var 'region=us-east-1'`,
    ],
    ["tofu apply -var 'db_pass=FAKEVALUE'", "tofu apply -var 'db_pass=[REDACTED]'"],
    ['terraform login -token FAKEVALUE', 'terraform login -token [REDACTED]'],
    // kubectl
    [
      'kubectl create secret generic s --from-literal=key=FAKEVALUE',
      'kubectl create secret generic s --from-literal=key=[REDACTED]',
    ],
    [
      'kubectl create secret generic s --from-literal=db=FAKEVALUE',
      'kubectl create secret generic s --from-literal=db=[REDACTED]',
    ],
    [
      'kubectl create secret generic s --from-literal=username=admin --from-literal=pw=FAKEVALUE',
      'kubectl create secret generic s --from-literal=username=[REDACTED] --from-literal=pw=[REDACTED]',
    ],
    [
      'kubectl create secret generic s --from-literal db=FAKEVALUE',
      'kubectl create secret generic s --from-literal db=[REDACTED]',
    ],
    // helm
    ['helm install x ./chart --set token=FAKEVALUE', 'helm install x ./chart --set token=[REDACTED]'],
    ['helm install x ./chart --set secret=FAKEVALUE', 'helm install x ./chart --set secret=[REDACTED]'],
    ['helm install x ./chart --set-string db.pass=FAKEVALUE', 'helm install x ./chart --set-string db.pass=[REDACTED]'],
    [
      'helm install x ./chart --set-string credentials=FAKEVALUE',
      'helm install x ./chart --set-string credentials=[REDACTED]',
    ],
    // ansible
    ['ansible-playbook site.yml -e token=FAKEVALUE', 'ansible-playbook site.yml -e token=[REDACTED]'],
    ["ansible-playbook site.yml -e 'secret=FAKEVALUE'", "ansible-playbook site.yml -e 'secret=[REDACTED]'"],
    [
      "ansible-vault encrypt_string 'FAKEVALUE' --name db_password",
      'ansible-vault encrypt_string [REDACTED] --name db_password',
    ],
    ['ansible-vault encrypt_string FAKEVALUE --name x', 'ansible-vault encrypt_string [REDACTED] --name x'],
    [
      "ansible-vault encrypt_string 'a1' 'FAKEVALUE' --name x",
      'ansible-vault encrypt_string [REDACTED] [REDACTED] --name x',
    ],
    // container tools
    [
      'skopeo copy --src-creds bob:FAKEVALUE docker://a docker://b',
      'skopeo copy --src-creds bob:[REDACTED] docker://a docker://b',
    ],
    ['podman pull --creds bob:FAKEVALUE quay.io/x', 'podman pull --creds bob:[REDACTED] quay.io/x'],
    // curl against vendor APIs
    [
      'curl -H "X-Consul-Token: FAKEVALUE" https://consul/v1/kv/x',
      'curl -H "X-Consul-Token: [REDACTED]" https://consul/v1/kv/x',
    ],
    [
      'curl -H "X-Gitlab-Token: FAKEVALUE" https://gitlab/api',
      'curl -H "X-Gitlab-Token: [REDACTED]" https://gitlab/api',
    ],
    ['curl -H "Api-Token: FAKEVALUE" https://x.io', 'curl -H "Api-Token: [REDACTED]" https://x.io'],
    [
      'curl -H "X-Auth-Key: FAKEVALUE" https://api.cloudflare.com',
      'curl -H "X-Auth-Key: [REDACTED]" https://api.cloudflare.com',
    ],
    ['curl -u FAKEVALUE: https://api.example.com', 'curl -u [REDACTED]: https://api.example.com'],
    ["curl -u 'FAKEVALUE:' https://api.example.com", "curl -u '[REDACTED]:' https://api.example.com"],
    ['curl -u "FAKEVALUE:" https://api.example.com', 'curl -u "[REDACTED]:" https://api.example.com'],
    ['curl --user "FAKEVALUE:" https://api.example.com', 'curl --user "[REDACTED]:" https://api.example.com'],
    // a key after a separator that isn't a space
    ['terraform apply -var=token=FAKEVALUE', 'terraform apply -var=token=[REDACTED]'],
    ['curl "https://x.io/?a=1&pass=FAKEVALUE"', 'curl "https://x.io/?a=1&pass=[REDACTED]"'],
    ['export A=1;token=FAKEVALUE', 'export A=1;token=[REDACTED]'],
    // ansible-vault with its flags before the plaintext
    ['ansible-vault encrypt_string --name x FAKEVALUE', 'ansible-vault encrypt_string --name x [REDACTED]'],
    ['ansible-vault encrypt_string -n x FAKEVALUE', 'ansible-vault encrypt_string -n x [REDACTED]'],
    [
      'ansible-vault encrypt_string --vault-id dev@prompt FAKEVALUE --name x',
      'ansible-vault encrypt_string --vault-id dev@prompt [REDACTED] --name x',
    ],
    [
      'ansible-vault encrypt_string --vault-password-file p FAKEVALUE',
      'ansible-vault encrypt_string --vault-password-file p [REDACTED]',
    ],
    ['curl --user FAKEVALUE: https://api.example.com', 'curl --user [REDACTED]: https://api.example.com'],
  ])('redacts %s', (command, expected) => {
    expect(redact(command)).toBe(expected)
  })
})

describe('infrastructure tooling: forms already covered keep their redaction', () => {
  it.each([
    `vault login -method=userpass username=bob password=${FAKE}`,
    `vault kv put secret/app password=${FAKE}`,
    `vault kv put secret/app api_key=${FAKE} user=bob`,
    `vault write auth/userpass/users/bob password=${FAKE}`,
    `VAULT_TOKEN=s.${FAKE} vault read secret/app`,
    `export VAULT_TOKEN=s.${FAKE}`,
    `aws configure set aws_secret_access_key wJalrXUtnFEMI/K7MDENG/bPxRfiCY${FAKE}`,
    `AWS_SESSION_TOKEN=FwoGZXIvYXdz${FAKE} aws s3 ls`,
    `export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCY${FAKE}`,
    `aws rds create-db-instance --db-instance-identifier x --master-user-password ${FAKE}`,
    `aws lambda update-function-configuration --function-name f --environment "Variables={DB_PASSWORD=${FAKE}}"`,
    `aws secretsmanager create-secret --name x --secret-string '{"password":"${FAKE}"}'`,
    `az login --username bob --password ${FAKE}`,
    `az ad sp create-for-rbac --name x --password ${FAKE}`,
    `az sql server create --name s --admin-user bob --admin-password ${FAKE}`,
    `gcloud sql users set-password bob --instance=i --password=${FAKE}`,
    `terraform apply -var 'db_password=${FAKE}'`,
    `terraform apply -var="db_password=${FAKE}"`,
    `terraform apply -var 'password=${FAKE}'`,
    `TF_VAR_db_password=${FAKE} terraform apply`,
    `export TF_VAR_api_token=${FAKE}`,
    `kubectl config set-credentials bob --token=${FAKE}`,
    `kubectl config set-credentials bob --username=bob --password=${FAKE}`,
    `kubectl create secret generic s --from-literal=password=${FAKE}`,
    `kubectl create secret docker-registry r --docker-username=u --docker-password=${FAKE}`,
    `kubectl --token=${FAKE} get pods`,
    `kubectl set env deploy/x DB_PASSWORD=${FAKE}`,
    `helm install x ./chart --set db.password=${FAKE}`,
    `helm install x ./chart --set adminToken=${FAKE}`,
    `helm install x ./chart --set auth.apiKey=${FAKE}`,
    `ansible-playbook site.yml -e ansible_password=${FAKE}`,
    `ansible-playbook site.yml -e "ansible_become_pass=${FAKE}"`,
    `ansible-playbook site.yml --extra-vars '{"db_password":"${FAKE}"}'`,
    `docker login -u bob -p ${FAKE}`,
    `docker login --username bob --password ${FAKE} registry.example.com`,
    `echo ${FAKE} | docker login -u bob --password-stdin`,
    `podman login -u bob -p ${FAKE} quay.io`,
    `docker run -e DB_PASSWORD=${FAKE} img`,
    `docker build --build-arg NPM_TOKEN=${FAKE} .`,
    `sshpass -p ${FAKE} ssh host`,
    `curl -u admin:${FAKE} https://vault.example.com`,
    `curl -H "Authorization: Bearer ${FAKE}12345" https://api.example.com`,
    `curl -X POST -d 'password=${FAKE}' https://vault.example.com/login`,
    `curl --data-urlencode "client_secret=${FAKE}" https://login.example.com/token`,
  ])('still redacts %s', (command) => {
    expect(redact(command)).not.toContain(FAKE)
  })
})

describe('infrastructure tooling: harmless commands stay as they are', () => {
  it.each([
    'vault status',
    'vault login -method=oidc',
    'vault login',
    'vault kv get secret/app',
    'vault kv put secret/app',
    'vault kv put -mount=secret app',
    'vault kv put secret/app @data.json',
    'vault operator init',
    'vault operator unseal',
    'aws s3 ls s3://my-bucket',
    'aws ssm get-parameter --name /app/db --with-decryption',
    'aws ssm put-parameter --name /app/db --type String',
    'aws secretsmanager get-secret-value --secret-id x',
    'aws sts get-caller-identity',
    'aws configure set region eu-west-1',
    'az login',
    'az account show',
    'az keyvault secret show --vault-name kv --name n',
    'gcloud auth login',
    'gcloud config set project my-project',
    'gcloud secrets create x --replication-policy=automatic --data-file=-',
    "terraform apply -var 'region=us-east-1'",
    "terraform apply -var 'instance_type=t3.micro'",
    "terraform apply -var 'token_ttl=1h'",
    'terraform plan -var-file=prod.tfvars',
    'terraform login',
    'terraform init',
    'kubectl get secret db -o yaml',
    'kubectl create secret generic s --from-file=./key.pem',
    'kubectl config set-context --current --namespace=prod',
    'kubectl label pod x token=true',
    'kubectl get pods -n kube-system',
    'helm install x ./chart --set image.tag=1.2.3',
    'helm install x ./chart --set replicas=3',
    'helm install x ./chart --set secretName=regcred',
    'helm install x ./chart --set tokenizer=fast',
    'helm list -A',
    'ansible-playbook site.yml -e env=prod',
    'ansible-playbook site.yml --ask-vault-pass',
    'ansible-vault view secrets.yml',
    'ansible-vault encrypt_string',
    'docker login',
    'docker run -p 8080:80 img',
    'docker ps -a',
    'sort --key=2,3 file.txt',
    'curl -s https://example.com/health',
    'curl -H "Content-Type: application/json" https://x.io',
    'curl -H "X-Request-Id: abc123" https://x.io',
    'curl -H "Idempotency-Key: abc123" https://x.io',
    'skopeo copy docker://a docker://b',
    'git commit -m "rotate the vault token"',
    'git commit -m "use a secret manager"',
    'echo hello | gcloud secrets list',
  ])('leaves %s alone', (command) => {
    expect(redact(command)).toBe(command)
  })
})

describe('infrastructure tooling: accepted over-redaction', () => {
  // A leak is worse than a lost word, so these shapes lose theirs, as `password=` always has
  it.each([
    ['curl -H "X-Csrf-Token: abc12345" https://x.io', 'curl -H "X-Csrf-Token: [REDACTED]" https://x.io'],
    ['docker run --label token=abc img', 'docker run --label token=[REDACTED] img'],
    ['curl -u bob: https://x.io', 'curl -u [REDACTED]: https://x.io'],
    [
      'kubectl create secret generic s --from-literal=user=me',
      'kubectl create secret generic s --from-literal=user=[REDACTED]',
    ],
    ['git commit -m "bump token=abc handling"', 'git commit -m "bump token=[REDACTED] handling"'],
    ['git commit -m "fix: set pass=1"', 'git commit -m "fix: set pass=[REDACTED]"'],
    ['sort -k pass=1 file.txt', 'sort -k pass=[REDACTED] file.txt'],
  ])('%s', (command, expected) => {
    expect(redact(command)).toBe(expected)
  })
})

describe('infrastructure tooling: left alone on purpose', () => {
  // A bare `key=` is too common a name for a field (`sort --key`, `kubectl label key=value`) to be read as a secret
  // outside the tools that take a secret by definition, so a decision, not an oversight (WOR-191)
  it('does not redact a bare key=', () => {
    expect(redact('helm install x ./chart --set key=FAKEVALUE')).toBe('helm install x ./chart --set key=FAKEVALUE')
  })
})
