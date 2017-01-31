'use strict';
var P = require('bluebird');
var _isArray = require('lodash/isArray');
var _isPlainObject = require('lodash/isPlainObject');
var _isFunction = require('lodash/isFunction');
var _find = require('lodash/find');
var _extend = require('lodash/extend');
var _transform = require('lodash/transform');
var Inflector = require('./inflector');

module.exports = function (jsonapi, data, opts) {
  function isComplexType(obj) {
    return _isArray(obj) || _isPlainObject(obj);
  }

  function getValueForRelationship(relationshipData, included) {
    if (opts && relationshipData && opts[relationshipData.type]) {
      var valueForRelationshipFct = opts[relationshipData.type]
        .valueForRelationship;

      return valueForRelationshipFct(relationshipData, included);
    } else {
      return included;
    }
  }

  function _findIncluded(relationshipData) {
    return new P(function (resolve) {
      if (!jsonapi.included || !relationshipData) { resolve(null); }

      var included = _find(jsonapi.included, {
        id: relationshipData.id,
        type: relationshipData.type
      });

      if (included) {
        return P
          .all([extractAttributes(included), extractRelationships(included)])
          .spread(function (attributes, relationships) {
            resolve(_extend(attributes, relationships));
          });
      } else {
        return resolve(null);
      }
    });
  }

  function keyForAttribute(attribute) {
    if (_isPlainObject(attribute)) {
      return _transform(attribute, function (result, value, key) {
        if (isComplexType(value)) {
          result[keyForAttribute(key)] = keyForAttribute(value);
        } else {
          result[keyForAttribute(key)] = value;
        }
      });
    } else if (_isArray(attribute)) {
      return attribute.map(function (attr) {
        if (isComplexType(attr)) {
          return keyForAttribute(attr);
        } else {
          return attr;
        }
      });
    } else {
      if (_isFunction(opts.keyForAttribute)) {
        return opts.keyForAttribute(attribute);
      } else {
        return Inflector.caserize(attribute, opts);
      }
    }
  }

  function extractAttributes(from) {
    var dest = keyForAttribute(from.attributes || {});
    if ('id' in from) { dest.id = from.id; }

    return dest;
  }

  function extractLinks(from) {
    var dest = keyForAttribute(from.links || {});

    return dest;
  }

  function extractRelationships(from) {
    if (!from.relationships) { return; }

    var dest = {};

    return P
      .each(Object.keys(from.relationships), function (key) {
        var relationship = from.relationships[key];

        if (relationship.data === null) {
          dest[keyForAttribute(key)] = null;
        } else if (_isArray(relationship.data)) {
          return P
            .map(relationship.data, function (relationshipData) {
              return extractIncludes(relationshipData);
            })
            .then(function (includes) {
              if (includes) { dest[keyForAttribute(key)] = includes; }
            });
        } else {
          return extractIncludes(relationship.data)
            .then(function (include) {
              if (include) { dest[keyForAttribute(key)] = include; }
            });
        }
      })
      .thenReturn(dest);
  }

  function extractIncludes(relationshipData) {
    return _findIncluded(relationshipData)
      .then(function (included) {
        var valueForRelationship = getValueForRelationship(relationshipData,
          included);

        if (valueForRelationship && _isFunction(valueForRelationship.then)) {
          return valueForRelationship.then(function (value) {
            return value;
          });
        } else {
          return valueForRelationship;
        }
      });
  }

  this.perform = function () {
    return P
      .all([extractAttributes(data), extractRelationships(data), extractLinks(data)])
      .spread(function (attributes, relationships, links) {
        return _extend(attributes, relationships, links);
      });
  };
};
