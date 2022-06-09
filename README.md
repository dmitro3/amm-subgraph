# fcxv2-amm-subgraph

## Deployment (BSC testnet - chapel)

* Start TheGraph node

```bash
# this instruction is live on 192.168.0.208

git clone https://github.com/graphprotocol/graph-node.git

cd graph-node/docker

# edit the docker-compose.yml file

docker-compose up -d

```

* Example docker-compose.yml file

```yaml
version: '3'
services:
  graph-node:
    image: graphprotocol/graph-node
    ports:
      - '8000:8000'
      - '8001:8001'
      - '8020:8020'
      - '8030:8030'
      - '8040:8040'
    depends_on:
      - ipfs
      - postgres
    environment:
      postgres_host: postgres
      postgres_user: graph-node
      postgres_pass: let-me-in
      postgres_db: graph-node
      ipfs: 'ipfs:5001'
      ethereum: 'chapel:https://data-seed-prebsc-1-s2.binance.org:8545'
      GRAPH_LOG: info
  ipfs:
    image: ipfs/go-ipfs:v0.4.23
    ports:
      - '5001:5001'
    volumes:
      - ./data/ipfs:/data/ipfs
  postgres:
    image: postgres
    ports:
      - '5477:5432'
    command: ["postgres", "-cshared_preload_libraries=pg_stat_statements"]
    environment:
      POSTGRES_USER: graph-node
      POSTGRES_PASSWORD: let-me-in
      POSTGRES_DB: graph-node
    volumes:
      - ./data/postgres:/var/lib/postgresql/data
```

* If you want to run two networks on one node

```yaml
# set the env of graph-node
ethereum: 'bsc:https://bsc-dataseed.binance.org chapel:https://data-seed-prebsc-1-s2.binance.org:8545'
```

* Create and deploy your graph

Clone project to same host and

```bash
# chapel network
yarn install
yarn codegen && yarn build
yarn create:chapel-local
yarn deploy:chapel-local

# TODO: bsc network (wait bsc smart contract deployment)
```
