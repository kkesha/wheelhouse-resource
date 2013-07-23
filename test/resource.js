/* global describe, it, before, after */
'use strict';

var chai = require('chai')
  , should = chai.should()
  , Resource = require('../index.js')
  , flatiron = require('flatiron')
  , app = flatiron.app
  , Backbone = require('backbone')
  , _ = require('lodash')
  , request = require('request')
  , cache = {}
  , port = 9070

describe('Resources: ', function(){
  before(function(){
    app.use(flatiron.plugins.http)
    app.use(flatiron.plugins.log)
    app.router.configure({
      strict: false
    })

    // testing only implementation of Backbone.Sync. Really, wheelhouse should have done this for us with something like wheelhouse-couch
    Backbone.sync = function(method, model, options){
      var success = options.success || function(){}

      switch (method){
        case 'read':
          if (model.id) success(cache[_.result(model, 'url')])
          else {
            var out = []
            _.each(cache, function(m, id){
              if (id.indexOf(_.result(model, 'url')) > -1) out.push(m)
            })
            success(out)
          }
          break
        case 'create':
          model.set({id: _.uniqueId()})
          cache[_.result(model, 'url')] = model.toJSON()
          success(model.id)
          break
        case 'update':
          cache[_.result(model, 'url')] = model.toJSON()
          success(model.id)
          break
        case 'delete':
          delete cache[_.result(model, 'url')]
          success()
          break
      }
    }
    app.Backbone = Backbone
  })

  describe('prerequisites', function(){
    var Collection = Backbone.Collection.extend({
        url: '/collection'
      })
      , collection = new Collection()

    it('app.backbone exists', function(){
      should.exist(app.Backbone)
    })

    it('returns JSON on create()', function(done){
      collection.create({key: 'value'}, {
        success: function(model){
          collection.get(model.id).get('key').should.equal('value')
          cache[_.result(model, 'url')].key.should.equal('value')
          done()
        }
      })
    })

    it('returns JSON on fetch', function(done){
      collection.reset()
      collection.length.should.equal(0)
      collection.fetch({success: function(coll){
        coll.first().get('key').should.equal('value')
        done()
      }})
    })

    after(function(){
      collection.reset()
    })
  })

  describe('a new resource', function(){
    var Collection = Backbone.Collection.extend({
        url: '/collection'
      })
      , collection = new Collection([{key: 'value1'}, {key: 'value2'}])

    before(function(done){
      app.start(port, done)
    })

    it('adds routes to the router', function(){
      new Resource(collection, {app: app })
      app.router.routes.collection.get.should.exist
      app.router.routes.collection['([_.()!\\ %@&a-zA-Z0-9-]+)'].get.should.exist
      app.router.routes.collection.post.should.exist
      app.router.routes.collection['([_.()!\\ %@&a-zA-Z0-9-]+)'].put.should.exist
      app.router.routes.collection['([_.()!\\ %@&a-zA-Z0-9-]+)'].delete.should.exist
    })

    it('populates the collection on creation', function(){
      var Collection = Backbone.Collection.extend({
        url: '/prePopulated'
      })
        , collection = new Collection()

      // fake like there's already 1 model in the db
      cache['/prePopulated/1'] = {key: 'prePopulatedValue'}

      ;new Resource(collection, {app: app}, function(err, collection){
        should.not.exist(err)
        // we should just get back the model we added to the DB above
        collection.length.should.equal(1)
        collection.first().get('key').should.equal('prePopulatedValue')
      })
    })

    it('creates', function(done){
      request.post({
        url: 'http://localhost:' + port + '/collection'
        , json: {key: 'created!'}
      }, function(err, res, body){
        should.not.exist(err)
        should.exist(body.id)
        collection.get(body.id).get('key').should.equal('created!')
        done()
      })
    })

    it('reads a collection', function(done){
      request.get({
        url: 'http://localhost:' + port + '/collection'
        , json: true
      }, function(err, res, body){
        should.not.exist(err)

        body.length.should.be.above(0)
        _.last(body).key.should.equal('created!')
        done()
      })
    })

    it('reads a model', function(done){
      var id = collection.last().id
      request.get({
        url: 'http://localhost:' + port + '/collection/' + id
        , json: true
      }, function(err, res, body){
        should.not.exist(err)

        body.id.should.equal(id)
        done()
      })
    })

    it('updates', function(done){
      collection.add({id: 1, key: 'not updated'})
      request.put({
        url: 'http://localhost:' + port + '/collection/1'
        , json: {id: 1, key: 'updated!'}
      }, function(err, res, body){
        should.not.exist(err)
        body.id.should.equal(1)
        cache['/collection/1'].key.should.equal('updated!')
        collection.get(1).get('key').should.equal('updated!')
        done()
      })
    })

    it('deletes', function(done){
      request.del({
        url: 'http://localhost:' + port + '/collection/1'
        , json: true
      }, function(err, res, body){
        should.not.exist(err)
        should.not.exist(body)
        should.not.exist(cache['/collection/1'])
        should.not.exist(collection.get(1))
        done()
      })
    })

    describe('permissions', function(){
      var isBlocked = function(method, done){
          var id = ''
          if (method === 'put' || method === 'del') id = permCollection.last().id

          request[method]({
            url: 'http://localhost:' + port + '/permCollection/' + id
            , json: {key: 'I should be blocked'}
          }, function(err, res, body){
            should.not.exist(err)

            res.statusCode.should.equal(403)
            body.status.should.equal(403)
            should.not.exist(permCollection.findWhere({key: 'I should be blocked'}))
            permCollection.length.should.equal(1)
            done()
          })
        }
        , PermCollection = Backbone.Collection.extend({
          url: '/permCollection'
        })
        , permCollection = new PermCollection({id: 1, key: 'not affected'})

      it('assigns default permissions of all public', function(){
        new Resource(permCollection, {
          app: app
        })

        permCollection.resource.permissions().should.eql(['create', 'read', 'update', 'del'])
      })

      it('blocks access to create', function(done){
        new Resource(permCollection, {
          app: app
          , permissions: function(){
            return ['read', 'update', 'del']
          }
        })
        isBlocked('post', done)
      })

      it('blocks access to read', function(done){
        new Resource(permCollection, {
          app: app
          , permissions: function(){
            return ['create', 'update', 'del']
          }
        })
        isBlocked('get', done)
      })

      it('blocks access to update', function(done){
        new Resource(permCollection, {
          app: app
          , permissions: function(){
            return ['create', 'read', 'del']
          }
        })
        isBlocked('put', done)
      })

      it('blocks access to delete', function(done){
        new Resource(permCollection, {
          app: app
          , permissions: function(){
            return ['create', 'read', 'update']
          }
        })
        isBlocked('del', done)
      })

      after(function(){
        permCollection.reset()
      })
    })

    it('can find the collection name from regex', function(){
      var NameTest = Backbone.Collection.extend({
          url: '/api/v1/nameTest'
        })
        , nameTest = new NameTest()
        , nameResource = new Resource(nameTest, {
          app: app
          , nameRegEx: /^\/api\/v1\/(.*)/
        })
      nameResource.name.should.equal('nameTest')
    })

    it('filters a collection', function(done){
      var FilterCollection = Backbone.Collection.extend({
          url: '/filterCollection'
        })
        , filterCollection = new FilterCollection({id: 1, key: 'a value'})

      ;new Resource(filterCollection, {
        app: app
        , filter: function(coll){
          _.each(coll, function(model){
            model.id = 'i changed you!'
          })
          return coll
        }
      })

      request.get({
        url: 'http://localhost:' + port + '/filterCollection/'
        , json: true
      }, function(err, res, body){
        should.not.exist(err)

        body[0].id.should.equal('i changed you!')
        filterCollection.get(1).id.should.equal(1)
        done()
      })
    })

    it('picks from a model', function(done){
      var PickCollection = Backbone.Collection.extend({
          url: '/pick'
        })
        , pickCollection = new PickCollection({id: 1, key: 'a value'})

      ;new Resource(pickCollection, {
        app: app
        , pick: function(model){
          return _.pick(model, 'key')
        }
      })

      request.get({
        url: 'http://localhost:' + port + '/pick/' + 1
        , json: true
      }, function(err, res, body){
        should.not.exist(err)

        should.not.exist(body.id)
        should.exist(body.key)
        body.key.should.equal('a value')
        done()
      })
    })

    after(function(done){
      collection.reset()
      cache = {}
      app.server.close(done)
    })
  })
})