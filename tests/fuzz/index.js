/**
 * Copyright 2017–2018, LaborX PTY
 * Licensed under the AGPL Version 3 license.
 * @author Egor Zuev <zyev.egor@gmail.com>
 */

const _ = require('lodash'),
  config = require('../../config'),
  Promise = require('bluebird'),
  uniqid = require('uniqid'),
  smartContractsEventsFactory = require('../../factories/smartContractsEventsFactory'),
  txLogModel = require('../../models/txLogModel'),
  pinModel = require('../../models/pinModel'),
  spawn = require('child_process').spawn,
  moment = require('moment'),
  parser = require('cron-parser'),
  base58toBytes32 = require('../../utils/encode/base58toBytes32'),
  queryResultToEventArgsConverter = require('../../utils/converters/queryResultToEventArgsConverter'),
  expect = require('chai').expect;

module.exports = (ctx) => {

  before(async () => {
    await txLogModel.remove({});
    await pinModel.remove({});

    ctx.ipfsServicePid = spawn('node', ['index.js'], {env: process.env, stdio: 'ignore'});
  });


  it('generate fake events', async () => {

    let generated = [];

    for (let event of config.events) {
      let definition = _.find(smartContractsEventsFactory.events, definition => {
        let name = definition.name.toLowerCase();
        return !!_.find(config.events, ev => ev.eventName === name);
      });

      for (let i = 0; i < 100; i++) {

        const builtArgs = ['0x0'];
        const sortedInputs = _.orderBy(definition.inputs, 'indexed', 'desc');
        const newHashInputIndex = _.findIndex(sortedInputs, {name: event.newHashField});

        for (let inputIndex = 0; inputIndex < sortedInputs.length; inputIndex++) {
          let val = '0x0';

          if (sortedInputs[inputIndex].name === event.newHashField) {

            let ipfsData = {
              Data: new Buffer(Math.random().toString(36).substr(2)),
              Links: []
            };

            let pushResult = await ctx.clients[0].object.put(ipfsData);
            val = base58toBytes32(pushResult.toJSON().multihash);
          }

          if (sortedInputs[inputIndex].name === event.oldHashField && _.random(0, 1) && generated.length > 0) {
            val = generated[_.random(0, generated.length - 1)].args[newHashInputIndex + 1];
          }

          builtArgs.push(val)
        }

        const dataIndexStart = _.findIndex(definition.inputs, {indexed: false});
        generated.push({
          _id: uniqid(),
          address: smartContractsEventsFactory.address,
          args: builtArgs,
          blockNumber: generated.length,
          dataIndexStart: dataIndexStart,
          index: generated.length,
          removed: false,
          signature: definition.signature,
          txIndex: generated.length
        })
      }
    }

    for (let item of generated)
      await txLogModel.create(item);
  });

  it('await for hashes to be grabbed by the service', async () => {

    const default_delay = moment(
      new Date(parser.parseExpression(config.schedule.fetchJob).next().toString())
    ).add(100 * config.events.length, 'seconds').diff(new Date());

    await Promise.delay(default_delay);

    let totalRecordsCount = 0;

    for (let event of config.events) {

      let definition = _.find(smartContractsEventsFactory.events, definition => {
        let name = definition.name.toLowerCase();
        return !!_.find(config.events, ev => ev.eventName === name);
      });


      let setHashes = await txLogModel.find({
        address: smartContractsEventsFactory.address,
        signature: definition.signature
      });

      let records = queryResultToEventArgsConverter(event.eventName, setHashes);


      const actualHashesInBlocks = _.chain(records)
        .orderBy('includedIn.blockNumber', 'asc')
        .transform((result, item) => {
          if (item[event.oldHashField])
            delete result[item[event.oldHashField]];
          result[item[event.newHashField]] = 1;
        }, {})
        .toPairs()
        .map(pair => pair[0])
        .uniq()
        .value();


      for (let hash of actualHashesInBlocks) {
        let item = _.find(records, {[event.newHashField]: hash});
        expect(item).to.not.be.undefined;
        let isExistsInDb = await pinModel.count({bytes32: hash});
        expect(isExistsInDb).to.eq(1);
      }

      totalRecordsCount += actualHashesInBlocks.length;

    }

    let totalPins = await pinModel.count();

    expect(totalRecordsCount).to.eq(totalPins);


  });

  it('remove random pins', async () => {

    let pinsCount = await pinModel.count();

    for (let i = 0; i < _.random(2, parseInt(pinsCount / 2)); i++) {
      let pin = await pinModel.findOne().skip(i);
      pin.remove();
    }

  });

  it('await for hashes to be grabbed by the service again', async () => {

    const default_delay = moment(
      new Date(parser.parseExpression(config.schedule.fetchJob).next().toString())
    ).add(100 * config.events.length, 'seconds').diff(new Date());

    await Promise.delay(default_delay);

    let totalRecordsCount = 0;

    for (let event of config.events) {

      let definition = _.find(smartContractsEventsFactory.events, definition => {
        let name = definition.name.toLowerCase();
        return !!_.find(config.events, ev => ev.eventName === name);
      });


      let setHashes = await txLogModel.find({
        address: smartContractsEventsFactory.address,
        signature: definition.signature
      });

      let records = queryResultToEventArgsConverter(event.eventName, setHashes);


      const actualHashesInBlocks = _.chain(records)
        .orderBy('includedIn.blockNumber', 'asc')
        .transform((result, item) => {
          if (item[event.oldHashField])
            delete result[item[event.oldHashField]];
          result[item[event.newHashField]] = 1;
        }, {})
        .toPairs()
        .map(pair => pair[0])
        .uniq()
        .value();


      for (let hash of actualHashesInBlocks) {
        let item = _.find(records, {[event.newHashField]: hash});
        expect(item).to.not.be.undefined;
        let isExistsInDb = await pinModel.count({bytes32: hash});
        expect(isExistsInDb).to.eq(1);
      }

      totalRecordsCount += actualHashesInBlocks.length;

    }

    let totalPins = await pinModel.count();
    expect(totalRecordsCount).to.eq(totalPins);
  });

  after(() => {
    ctx.ipfsServicePid.kill();
  })

};
