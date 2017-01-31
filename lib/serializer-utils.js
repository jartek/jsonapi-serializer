'use strict';
var _isArray = require('lodash/isArray');
var _isPlainObject = require('lodash/isPlainObject');
var _isFunction = require('lodash/isFunction');
var _isUndefined = require('lodash/isUndefined');
var _isNull = require('lodash/isNull');
var _transform = require('lodash/transform');
var _mapValues = require('lodash/mapValues');
var _mapKeys = require('lodash/mapKeys');
var _pick = require('lodash/pick');
var _find = require('lodash/find');
var _keys = require('lodash/keys');
var _each = require('lodash/each');
var Inflector = require('./inflector');

module.exports = function (collectionName, record, payload, opts) {
  function isComplexType(obj) {
    return _isArray(obj) || _isPlainObject(obj);
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

  function getId() {
    return opts.id || 'id';
  }

  function getRef(current, item, opts) {
    if (_isFunction(opts.ref)) {
      return opts.ref(current, item);
    } else if (opts.ref === true) {
      if (_isArray(item)) {
        return item.map(function (val) {
          return String(val);
        });
      } else if (item) {
        return String(item);
      }
    } else if (item && item[opts.ref]){
      return String(item[opts.ref]);
    }
  }

  function getType(str, attrVal) {
    var type;
    attrVal = attrVal || {};

    if (_isFunction(opts.typeForAttribute)) {
      type = opts.typeForAttribute(str, attrVal);
    }

    // If the pluralize option is on, typeForAttribute returned undefined or wasn't used
    if((_isUndefined(opts.pluralizeType) || opts.pluralizeType) && _isUndefined(type)) {
      type = Inflector.pluralize(str);
    }

    if(_isUndefined(type)) {
      type = str;
    }

    return type;
  }

  function getLinks(current, links, dest) {
    return _mapValues(links, function (value) {
      if (_isFunction(value)) {
        return value(record, current, dest);
      } else {
        return value;
      }
    });
  }

  function getMeta(current, meta) {
    return _mapValues(meta, function (value) {
      if (_isFunction(value)) {
        return value(record, current);
      } else {
        return value;
      }
    });
  }

  function pick(obj, attributes) {
    return _mapKeys(_pick(obj, attributes), function (value, key) {
      return keyForAttribute(key);
    });
  }

  function isCompoundDocumentIncluded(included, item) {
    return _find(payload.included, { id: item.id, type: item.type });
  }

  function pushToIncluded(dest, include) {
    if (!isCompoundDocumentIncluded(dest, include)) {
      if (!dest.included) { dest.included = []; }
      dest.included.push(include);
    }
  }

  this.serialize = function (dest, current, attribute, opts) {
    var that = this;
    var data = null;

    if (opts && opts.ref) {
      if (!dest.relationships) { dest.relationships = {}; }

      if (_isArray(current[attribute])) {
        data = current[attribute].map(function (item) {
          return that.serializeRef(item, current, attribute, opts);
        });
      } else {
        data = that.serializeRef(current[attribute], current, attribute,
          opts);
      }

      dest.relationships[keyForAttribute(attribute)] = {};
      if (!opts.ignoreRelationshipData) {
        dest.relationships[keyForAttribute(attribute)].data = data;
      }

      if (opts.relationshipLinks) {
        dest.relationships[keyForAttribute(attribute)].links =
          getLinks(current[attribute], opts.relationshipLinks, dest);
      }

      if (opts.relationshipMeta) {
        dest.relationships[keyForAttribute(attribute)].meta =
          getMeta(current[attribute], opts.relationshipMeta);
      }
    } else {
      if (_isArray(current[attribute])) {
        if (current[attribute].length && _isPlainObject(current[attribute][0])) {
          data = current[attribute].map(function (item) {
            return that.serializeNested(item, current, attribute, opts);
          });
        } else {
          data = current[attribute];
        }

        dest.attributes[keyForAttribute(attribute)] = data;
      } else if (_isPlainObject(current[attribute])) {
        data = that.serializeNested(current[attribute], current, attribute, opts);
        dest.attributes[keyForAttribute(attribute)] = data;
      } else {
        dest.attributes[keyForAttribute(attribute)] = current[attribute];
      }
    }
  };

  this.serializeRef = function (dest, current, attribute, opts) {
    var that = this;
    var id = getRef(current, dest, opts);
    var type = getType(attribute, dest);

    var relationships = [];
    var includedAttrs = [];

    if (opts.attributes) {
      relationships = opts.attributes.filter(function (attr) {
        return opts[attr];
      });

      includedAttrs = opts.attributes.filter(function (attr) {
        return !opts[attr];
      });
    }

    var included = { type: type, id: id };
    if (includedAttrs) { included.attributes = pick(dest, includedAttrs); }

    relationships.forEach(function (relationship) {
      if (dest && isComplexType(dest[relationship])) {
        that.serialize(included, dest, relationship, opts[relationship]);
      }
    });

    if (includedAttrs.length &&
      (_isUndefined(opts.included) || opts.included)) {
      if (opts.includedLinks) {
        included.links = getLinks(dest, opts.includedLinks);
      }

      if (typeof id !== 'undefined') { pushToIncluded(payload, included); }
    }

    return typeof id !== 'undefined' ? { type: type, id: id } : null;
  };

  this.serializeNested = function (dest, current, attribute, opts) {
    var that = this;

    var embeds = [];
    var attributes = [];

    if (opts && opts.attributes) {
      embeds = opts.attributes.filter(function (attr) {
        return opts[attr];
      });

      attributes = opts.attributes.filter(function (attr) {
        return !opts[attr];
      });
    } else {
      attributes = _keys(dest);
    }

    var ret = {};
    if (attributes) { ret.attributes = pick(dest, attributes); }

    embeds.forEach(function (embed) {
      if (isComplexType(dest[embed])) {
        that.serialize(ret, dest, embed, opts[embed]);
      }
    });

    return ret.attributes;
  };

  this.perform = function () {
    var that = this;

    if( _isNull( record ) ){
        return null;
    }

    // Top-level data.
    var data = {
      type: getType(collectionName, record),
      id: String(record[getId()])
    };

    // Data links.
    if (opts.dataLinks) {
      data.links = getLinks(record, opts.dataLinks);
    }

    _each(opts.attributes, function (attribute) {
      var splittedAttributes = attribute.split(':');

      if (splittedAttributes[0] in record ||
        (opts[attribute] && opts[attribute].nullIfMissing)) {

        if (!data.attributes) { data.attributes = {}; }
        var attributeMap = attribute;
        if (splittedAttributes.length > 1) {
          attribute = splittedAttributes[0];
          attributeMap = splittedAttributes[1];
        }

        that.serialize(data, record, attribute, opts[attributeMap]);
      }
    });

    return data;
  };
};
