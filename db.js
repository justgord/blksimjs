const assert    = require('assert');
const ps        = require('process');
const levelup   = require('levelup');
const fs        = require('fs');
const z         = require('./zutil.js');


const jlog      = z.jlog;
const each      = z.each;
const padn      = z.padn;
const pct       = z.pct;
const ts        = z.ts;


function onerrlog(_s)
{
    var s=_s;
    return function(err)
    {
        if (err) 
            return z.log('ERR : '+s);
    }
}

///

var DB_LDB=1;


var db = {};


function trace_blocks(cb)
{
    z.log('ldb blocks :');

    var blks={}; 

    var rs = db.blkid.createReadStream();
    rs.on('data', function (d) {
        blks[d.key]=d.value; 
    })
    .on('error', function (err) {
        z.log('LDB ERR : ', err)
    })
    .on('end', function () {
        function shw(blid, bln) 
        {
            if (blid=="NULL")
                return;
            z.log(' block : '+padn(bln,4)+'  : '+blid);
        }
        each(shw,blks);

        if (cb)
            cb();
    })
}

function db_init(cb)
{
    function db_init_ldb()
    {
        assert(fs.existsSync('../ldb/'),'ERR opening LDB dir');

        db.txn   = levelup('../ldb/ldb_txn');
        db.txnby = levelup('../ldb/ldb_txnby');
        db.blkby = levelup('../ldb/ldb_blkby');
        db.blkid = levelup('../ldb/ldb_blkid');

        trace_blocks(cb);
    }

    function db_init_pg()
    {
    }

    if (DB_LDB)
        db_init_ldb();
    else
        db_init_pg();
}

function db_save_block(blid, blknum, blby)
{
if (DB_LDB)
{
    db.blkby.put(blid,   blby,   onerrlog('db bad write blkby'));
    db.blkid.put(blknum, blid,   onerrlog('db bad write blkid'));
}
else
{

}
}

function db_save_tx(tid, tx, txb)
{
if (DB_LDB)
{
    db.txn.put(  tid, tx,  onerrlog('db bad write txn'));
    db.txnby.put(tid, txb, onerrlog('db bad write txnby'));
}
}

function db_close()
{
if (DB_LDB)
{
    return;         //pthread mutex busy issue
    db.txn.close();
    db.txnby.close();
    db.blkby.close();
    db.blkid.close();
}
else
{
}
}

function db_sync()
{
    if (DB_LDB)
    {
        var opts={'sync':true};
        var k = "NULL";
        var v = "NULL";

        db.txn.put(k,v,opts);
        db.txnby.put(k,v,opts);

        db.blkby.put(k,v,opts);
        db.blkid.put(k,v,opts);
    }
    
}

///

module.exports =
{
    init        :   db_init,
    close       :   db_close,
    save_tx     :   db_save_tx,
    save_block  :   db_save_block,
    sync        :   db_sync,
}


