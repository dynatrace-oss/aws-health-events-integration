const assert = require('assert')
const rewire = require('rewire')
const transformer = rewire('../transformer.js')

function cloneJson (json) {
  return JSON.parse(JSON.stringify(json))
}

describe('transformer', () => {
  describe('transform2DTEventType', () => {
    const transform2DTEventType = transformer.__get__('transform2DTEventType')

    it('handle issue eventTypeCategory', () => {
      assert.equal(transform2DTEventType({ detail: { eventTypeCategory: 'issue' } }), 'AVAILABILITY_EVENT')
    })

    it('handle accountNotification eventTypeCategory', () => {
      assert.equal(transform2DTEventType({ detail: { eventTypeCategory: 'accountNotification' } }), 'CUSTOM_ANNOTATION')
    })

    it('handle scheduledChange eventTypeCategory', () => {
      assert.equal(transform2DTEventType({ detail: { eventTypeCategory: 'scheduledChange' } }), 'CUSTOM_ANNOTATION')
    })

    it('handle unknown eventTypeCategory', () => {
      try {
        transform2DTEventType({ detail: { eventTypeCategory: 'issue' } })
        assert.fail('expected exception to be thrown')
      } catch (e) {
      }
    })
  })

  describe('getEventDescriptionByLocale', () => {
    const getEventDescriptionByLocale = transformer.__get__('getEventDescriptionByLocale')

    const eventDescription = [{ latestDescription: 'en_US_text1', language: 'en_US' },
      { latestDescription: 'de_DE_text', language: 'de_DE' },
      { latestDescription: 'en_US_text2', language: 'en_US' }]

    it('get 1st result for existing locale, en_US, although locale exists multiple times', () => {
      assert.equal(getEventDescriptionByLocale(eventDescription, 'en_US'), 'en_US_text1')
    })

    it('get result for existing locale, de_DE', () => {
      assert.equal(getEventDescriptionByLocale(eventDescription, 'de_DE'), 'de_DE_text')
    })

    it('get default value for non-existing locale', () => {
      assert.equal(getEventDescriptionByLocale(eventDescription, 'not existing'), '-')
    })
  })

  describe('transform2DTTitle', () => {
    const transform2DTTitle = transformer.__get__('transform2DTTitle')

    it('default behavior', () => {
      assert.equal(transform2DTTitle({
        detail: {
          eventTypeCategory: 'eventTypeCategory',
          eventTypeCode: 'eventTypeCode',
          service: 'service',
          eventDescription: [{ latestDescription: 'en_US_text', language: 'en_US' }]
        }
      }), 'AWS Health: eventTypeCategory/eventTypeCode impacting service: en_US_text')
    })
  })

  describe('transformTime2UTCMilliseconds', () => {
    const transformTime2UTCMilliseconds = transformer.__get__('transformTime2UTCMilliseconds')
    it('default behavior', () => {
      assert.equal(transformTime2UTCMilliseconds('Mon Apr 04 2022 12:56:31 GMT+0200'), 1649069791000)
    })
  })

  describe('appendStartTime & appendEndTime', () => {
    const appendStartTime = transformer.__get__('appendStartTime')
    const appendEndTime = transformer.__get__('appendEndTime')

    it('adding startTime & endTime', () => {
      const dateTimeStr = 'Mon Apr 04 2022 12:56:31 GMT+0200'
      const awsEvent = { detail: { startTime: dateTimeStr, endTime: dateTimeStr } }
      const time = 1649069791000
      assert.deepEqual(appendStartTime({}, awsEvent), { startTime: time })
      assert.deepEqual(appendEndTime({}, awsEvent), { endTime: time })
    })

    it('no startTime exists', () => {
      assert.deepEqual(appendStartTime({}, {}), {})
      assert.deepEqual(appendEndTime({}, {}), {})
    })
  })

  describe('appendProperties', () => {
    const appendProperties = transformer.__get__('appendProperties')

    it('creates properties object', () => {
      assert.deepEqual(appendProperties({}, { a: 1 }), { properties: { a: 1 } })
    })

    it('adds to properties object', () => {
      assert.deepEqual(appendProperties({ properties: { a: 1 } }, { b: 1 }), { properties: { a: 1, b: 1 } })
    })

    it('flattens nested ', () => {
      assert.deepEqual(appendProperties({ properties: { a: 1 } }, { b: { c: 1 } }), { properties: { a: 1, 'b.c': 1 } })
    })

    it('remove empty arrays ', () => {
      assert.deepEqual(appendProperties({ properties: { a: 1 } }, { resources: [] }), { properties: { a: 1 } })
    })
  })

  describe('appendEntityARNs2AffectedEntities', () => {
    const appendEntityARNs2AffectedEntities = transformer.__get__('appendEntityARNs2AffectedEntities')

    const awsEvent = {
      region: 'region',
      account: 'account',
      detail: {
        service: 'ec2',
        affectedEntities: [{ entityValue: 'a' }, { entityValue: 'b' }]
      }
    }

    it('has entityARNs added', () => {
      const awsEventWithEntityARNs = cloneJson(awsEvent)
      awsEventWithEntityARNs.detail.affectedEntities =
        awsEventWithEntityARNs.detail.affectedEntities.map(ae => {
          return { ...ae, ...{ entityARN: `arn:aws:ec2:region:account:instance/${ae.entityValue}` } }
        })

      assert.deepEqual(appendEntityARNs2AffectedEntities(awsEvent), awsEventWithEntityARNs)
    })
  })

  describe('appendEntitySelector', () => {
    const appendEntitySelector = transformer.__get__('appendEntitySelector')

    const awsEvent = {
      region: 'region',
      account: 'account',
      detail: {
        service: 'ec2',
        affectedEntities: [
          { entityValue: 'a', entityARN: 'arn:aws:ec2:region:account:instance/a' },
          { entityValue: 'b', entityARN: 'arn:aws:ec2:region:account:instance/b' }]
      }
    }

    const eventIngestObj = appendEntitySelector({}, awsEvent)
    assert.equal(eventIngestObj.entitySelector, 'type("EC2_INSTANCE"),arn("arn:aws:ec2:region:account:instance/a","arn:aws:ec2:region:account:instance/b")')
  })
})

// function transform2DTEvent(awsEvent) {
// }
