(function() {
	
var ui = angular.module('axelor.ui');

this.TreeViewCtrl = TreeViewCtrl;
this.TreeViewCtrl.$inject = ['$scope', '$element', 'DataSource', 'ActionService'];

function TreeViewCtrl($scope, $element, DataSource, ActionService) {

	var view = $scope._views['tree'];
	var viewPromise = $scope.loadView('tree', view.name);

	$scope.applyLater(function() {
		if (view.deferred) {
			view.deferred.resolve($scope);
		}
	});
	
	viewPromise.success(function(fields, schema){
		$scope.parse(schema);
	});
	
	$scope.show = function() {
		$scope.updateRoute();
	};

	$scope.onShow = function(promise) {
	
	};

	$scope.getRouteOptions = function() {
		return {
			mode: "tree"
		};
	};
	
	$scope.setRouteOptions = function(options) {
		$scope.updateRoute();
	};
	
	$scope.parse = function(schema) {
		
		var columns = _.map(schema.columns, function(col) {
			return new Column($scope, col);
		});

		var last = null;
		var draggable = false;

		var loaders = _.map(schema.nodes, function(node) {
			var loader = new Loader($scope, node, DataSource);
			if (last) {
				last.child = loader;
			}
			if (loader.draggable) {
				draggable = true;
			}
			return last = loader;
		});

		$scope.columns = columns;
		$scope.loaders = loaders;
		$scope.draggable = draggable;
	};

	$scope.onClick = function(e, options) {
		
		var loader = options.loader,
			record = options.record;

		if (!loader.action) {
			return;
		}

		if (record.$handler === undefined) {
			record.$handler = ActionService.handler($scope.$new(), $(e.currentTarget), {
				action: loader.action
			});
		}
		
		if (record.$handler) {
			
			var model = loader.model;
			var context = record.$record;
			
			record.$handler.scope.record = context;
			record.$handler.scope.getContext = function() {
				return _.extend({
					_model: model,
				}, context);
			};

			record.$handler.onClick().then(function(res){

			});
		}
	};
}

/**
 * Column controller.
 * 
 */
function Column(scope, col) {

	this.css = col.type || 'string';
	this.name = col.name;
	this.title = col.title;

	if (this.title === null || this.title === undefined) {
		this.title = _.humanize(col.name);
	}

	this.cellCss = function(record) {
		return this.css;
	};
	
	this.cellText = function(record) {
		var text = record[this.name];
		if (text === undefined) {
			return '---';
		}
		return text;
	}; 
}

/**
 * Node loader.
 * 
 */
function Loader(scope, node, DataSource) {

	var ds = DataSource.create(node.model);
	var names = _.pluck(node.fields, 'name');
	var domain = null;
	
	if (node.parent) {
		domain = "self." + node.parent + ".id = :parent";
	}

	this.child = null;
	
	this.model = node.model;

	this.action = node.onClick;
	
	this.draggable = node.draggable;

	this.load = function(parent, callback) {

		var context = {};
		
		if (parent) {
			context.parent = parent.id;
		}

		var promise = ds.search({
			fields: names,
			domain: domain,
			context: context,
			archived: true
		});

		promise.success(function(records) {
			if (callback) {
				callback(accept(records, parent));
			}
		});

		return promise;
	};

	this.move = function(record, parentId, callback) {
		
		var parent = {
			id: parentId
		};

		record[node.parent] = parent;

		return ds.save(record).success(function(rec) {
			record.version = rec.version;
			if (callback) {
				callback(rec);
			}
		});
	};
	
	var that = this;
	
	function accept(records, parent) {

		var fields = node.fields;
		var child = that.child;

		return _.map(records, function(record) {

			var item = {
				'$id': record.id,
				'$record': record,
				'$parent': parent && parent.id,
				'$draggable': node.draggable,
				'$folder': child != null,
				'$expand': function(fn) {
					if (child) {
						return child.load(record, fn);
					}
				},
				'$move': function(fn) {
					var record = this.$record,
						parent = this.$parent;
					return that.move(record, parent, fn);
				}
			};
			
			if (node.onClick) {
				item.$click = function(e) {
					scope.onClick(e, {
						loader: that,
						record: item,
						parent: parent
					});
				};
			}

			_.each(fields, function(field) {
				item[field.as || field.name] = record[field.name];
			});

			return item;
		});
	};
}

ui.directive('uiViewTree', function(){

	return {
		
		replace: true,
		
		link: function(scope, element, attrs) {
			
			element.treetable({
				
				expandable: true,
				
				clickableNodeNames: true,
				
				nodeIdAttr: "id",

				parentIdAttr: "parent",

				branchAttr: "folder",
				
				onNodeCollapse: function onNodeCollapse() {
					var node = this,
						row = node.row;

					if (node._state === "collapsed") {
						return;
					}
					node._state = "collapsed";
					
					element.treetable("collapseNode", row.data("id"));
				},

				onNodeExpand: function onNodeExpand() {

					var node = this,
						row = this.row,
						record = row.data('$record');
					
					if (node._loading || node._state === "expanded") {
						return;
					}
					
					node._state = "expanded";

					if (node._loaded) {
						return element.treetable("expandNode", row.data("id"));
					}

					node._loading = true;

					if (record.$expand) {
						record.$expand(function(records) {
							acceptNodes(records, node);
							node._loading = false;
							node._loaded = true;
						});
					}
				}
			});

			function acceptNodes(records, after) {
				var rows = _.map(records, makeRow);
				element.treetable("loadBranch", after, rows);
			}

			function makeRow(record) {

				var tr = $('<tr>')
					.attr('data-id', record.$id)
					.attr('data-parent', record.$parent)
					.attr('data-folder', record.$folder);

				tr.data('$record', record);

				_.each(scope.columns, function(col) {
					$('<td>').html(col.cellText(record)).appendTo(tr);
				});
				
				if (scope.draggable && record.$folder) {
					makeDroppable(tr);
				}

				return tr[0];
			}
			
			function onDrop(e, ui) {
				
				var row = ui.draggable,
					record = row.data('$record'),
					node = element.treetable("node", row.data("id"));

				element.treetable("move", node.id, $(this).data("id"));
				
				record.$parent = node.parentId;
				record.$move(function(result) {
				
				});
			}
			
			function makeDroppable(row) {
				row.droppable({
					accept: "tr[data-parent]",
			        hoverClass: "accept",
			        drop: onDrop,
			        over: function(e, ui) {
			        	var row = ui.draggable;
			        	if(this != row[0] && !$(this).is(".expanded")) {
			        		element.treetable("expandNode", $(this).data("id"));
			        	}
			        }
				});
			}

			function makeDraggable(row) {

				var record = row.data('$record');
				if (!record.$draggable) {
					return;
				}

				row.draggable({
					helper: function() {
						return $('<span></span>').append(row.children('td:first').clone());
					},
					opacity: .75,
					containment: 'document',
					refreshPositions: true,
					revert: "invalid",
					revertDuration: 300,
					scroll: true
				});
			}

			element.on('dblclick.treeview', 'tbody tr', function(e) {
				var record = $(e.currentTarget).data('$record');
				if (record && record.$click) {
					record.$click(e);
				}
			});

			element.on('mousedown.treeview', 'tbody tr', function(e) {
				element.find('tr.selected').removeClass('selected');
				$(this).addClass("selected");
			});
			
			element.on('mouseenter.treeview', 'tr[data-parent]', function(e) {
				var row = $(this);
				if (row.data("dndInit")) {
					return;
				}
				row.data("dndInit", true);
				makeDraggable(row);
			});

			var watcher = scope.$watch('loaders', function(loaders) {
				
				if (loaders === undefined) {
					return;
				}
				
				watcher();
					
				var root = _.first(loaders);
				if (root) {
					root.load(null, acceptNodes);
				}
			});
		},
		template:
		'<table>'+
			'<thead>'+
				'<tr>'+
					'<th ng-repeat="column in columns" ng-class="column.css">{{column.title}}</th>'+
				'</tr>'+
			'</thead>'+
			'<tbody>'+
			'</tbody>'+
		'</table>'
	};
});

}).call(this);
