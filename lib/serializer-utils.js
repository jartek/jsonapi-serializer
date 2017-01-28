'use strict';
var isArray = require('lodash/fp/isArray');
var isPlainObject = require('lodash/fp/isPlainObject');
var isFunction = require('lodash/fp/isFunction');
var isUndefined = require('lodash/fp/isUndefined');
var isNull = require('lodash/fp/isNull');
var transform = require('lodash/fp/transform');
var mapValues = require('lodash/fp/mapValues');
var mapKeys = require('lodash/fp/mapKeys');
var pick = require('lodash/fp/pick');
var find = require('lodash/fp/find');
var keys = require('lodash/fp/keys');
var each = require('lodash/fp/each');
var Inflector = require('./inflector');

module.exports = function (collectionName, record, payload, opts) {
  function isComplexType(obj) {
    return isArray(obj) || isPlainObject(obj);
  }

  function keyForAttribute(attribute) {
    if (isPlainObject(attribute)) {
      return transform(attribute, function (result, value, key) {
        if (isComplexType(value)) {
          result[keyForAttribute(key)] = keyForAttribute(value);
        } else {
          result[keyForAttribute(key)] = value;
        }
      });
    } else if (isArray(attribute)) {
      return attribute.map(function (attr) {
        if (isComplexType(attr)) {
          return keyForAttribute(attr);
        } else {
          return attr;
        }
      });
    } else {
      if (isFunction(opts.keyForAttribute)) {
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
    if (isFunction(opts.ref)) {
      return opts.ref(current, item);
    } else if (opts.ref === true) {
      if (isArray(item)) {
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

    if (isFunction(opts.typeForAttribute)) {
      type = opts.typeForAttribute(str, attrVal);
    }

    // If the pluralize option is on, typeForAttribute returned undefined or wasn't used
    if ((isUndefined(opts.pluralizeType) || opts.pluralizeType) && isUndefined(type)) {
      type = Inflector.pluralize(str);
    }

    if (isUndefined(type)) {
      type = str;
    }

    return type;
  }

  function getLinks(current, links, dest) {
    return mapValues(links, function (value) {
      if (isFunction(value)) {
        return value(record, current, dest);
      } else {
        return value;
      }
    });
  }

  function getMeta(current, meta) {
    return mapValues(meta, function (value) {
      if (isFunction(value)) {
        return value(record, current);
      } else {
        return value;
      }
    });
  }

  function pick(obj, attributes) {
    return mapKeys(pick(obj, attributes), function (value, key) {
      return keyForAttribute(key);
    });
  }

  function isCompoundDocumentIncluded(included, item) {
    return find(payload.included, { id: item.id, type: item.type });
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

      if (isArray(current[attribute])) {
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
      if (isArray(current[attribute])) {
        if (current[attribute].length && isPlainObject(current[attribute][0])) {
          data = current[attribute].map(function (item) {
            return that.serializeNested(item, current, attribute, opts);
          });
        } else {
          data = current[attribute];
        }

        dest.attributes[keyForAttribute(attribute)] = data;
      } else if (isPlainObject(current[attribute])) {
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
      (isUndefined(opts.included) || opts.included)) {
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
      attributes = keys(dest);
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

    if( isNull( record ) ){
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

    each(opts.attributes, function (attribute) {
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
