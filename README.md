# blksimjs


## Blockchain simulator in node.js

Simulates growth of a cryptocurrency blockchain [ similar to Bitcoin ], 
loops thru a cycle of :
* spend - pick addresses at random and spend to another address
* mine - put waiting transactions into the block, mine the cryptographic hash, add to chain

## Features / Limitations :

* uses single sha256 bit hash for ids
* uses an easy Proof-of-work [ 256 tries on average to get a block hashs with '00' leading bytes ]
* uses node.js byte buffers for transactions and blocks
* runs around 7000 tps on i5 laptop [ uses a lot of ram ]
* simple transactions - spend from one addr to one other addr with change [ uses vinps, vouts ]
* blocks contain hashids of transactions, but not actual tx bodies

## Motivation

I wanted to simulate the growth of a blockchain with unspent transactions spread 
somewhat sparsely at the early older parts of the blockchain, and more dense
at the top of the blockchain [as more recent transactions havent had time to be spent yet ].

The reason for this is to test the feasibility of reducing the size of the data 
needed to bootstrap a new node.  eg. in Bitcoin the whole dataset is :
* around 150GB of transactions [ 250Mn txns ]
* utxo of around 2GB [ ~50Mn txns ]
* so unspent 'utxo' set is around 20% of transactions

## Bring UTXO set forward

We can use much less data [5x smaller ] when spinning up a new node, by bringing utxo set forward to nearer the front of the chain.  The sim gathers old utxos and injects them into the blockchain in baches of ids, so they are stamped into the block at block creation.

These 'utxo catchup sections' are read when starting a new processing node -
ie. it only needs a provable list of utxos, not the complete history of all 
spent transactions.

## skip links [ todo ]

Using block extension areas, we can also include skip links to blocks much earlier in the chain -
the process of walking back thru the links of transactions inputs and outputs all the way back to the initial 'genesis' block
is like walking a DAG tree, as un-needed areas of the blockchain are skipped over.  These skip links are validated at block creation time by other nodes.   

This is useful for clients which want to traverse the chain to make better proof of validity than SPV, and for nodes that use utxo bring forward above, so they can trace PoW to an arbitrary level back to the genesis block. 

Not implemented yet 

## licence

MIT use without restraint

## Author

gord anderson
quantblog.wordpress.com

