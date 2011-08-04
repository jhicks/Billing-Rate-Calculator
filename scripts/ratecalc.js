$(function() {
  var validateRequiredPositiveNumber = function(num) {
    return validateNumber(num,0.00000000001);
  };

  var validateNumber = function(num,minValid) {
    var suspect = Number(num);

    var isInvalid = _.isNaN(suspect);
    isInvalid = isInvalid || _.isNull(suspect);
    isInvalid = isInvalid || !_.isNumber(suspect);
    isInvalid = isInvalid || suspect < minValid;

    return !isInvalid;
  };

  Calculator = Backbone.Model.extend({
    defaults: {
      billable_hours: 1560,
      payable_hours: 2080,
      pay: 130000,
      pay_type: "Per Year",
      margin: 10
    },
    
    initialize: function() {
      this.calculate_lock = false;
      this.expenses = new ExpensesCollection;
      this.taxes = new TaxesCollection;

      this.taxes.bind('add',function(tax) { 
        tax.calculator = this; 
        this.calculate();
      }, this);
      this.taxes.bind('change', this.calculate, this);
      this.taxes.bind('remove', this.calculate, this);

      this.expenses.bind('add',function(expense) { 
        expense.calculator = this; 
        this.calculate(); 
      },this);
      this.expenses.bind('change', this.calculate, this);
      this.expenses.bind('remove', this.calculate, this);

      this.bind('change',this.calculate,this);

      this.bind('error', function(model,error) {
        alert('Error: ' + error);
        model.change();
      });
    },

    validate: function(attr) {
      if(!_.isUndefined(attr.billable_hours) && !validateRequiredPositiveNumber(attr.billable_hours)) {
        return 'Billable Hours is required.  It must be a number greater than 0';
      }

      if(!_.isUndefined(attr.payable_hours) && !validateRequiredPositiveNumber(attr.payable_hours)) {
        return 'Payable Hours is required.  It must be a number greater than 0';
      }

      if(!_.isUndefined(attr.pay) && !validateRequiredPositiveNumber(attr.pay)) {
        return 'Wages is required.  It must be a number greater than 0';
      }
    },

    isPayPerYear: function() {
      return this.get('pay_type') === 'Per Year';
    },
    
    isPayPerHour: function() {
      return this.get('pay_type') === 'Per Hour';
    },

    getHourlyPay: function() {
      if(this.isPayPerYear()) {
        return Number(this.get('pay')) / Number(this.get('payable_hours'));
      }

      return Number(this.get('pay'));
    },

    getYearlyPay: function() {
      if(this.isPayPerHour()) {
        return Number(this.get('pay')) * Number(this.get('payable_hours'));
      }

      return Number(this.get('pay'));
    },

    getExpensesPerHour: function() {
      var result = this.expenses.getTotal() / Number(this.get('payable_hours'));
      return result;
    },

    getTotalExpenses: function() {
      var result = this.expenses.getTotal();
      return result;
    },

    getTotalTaxLiability: function() {
      var result = this.taxes.getTotal(this.getYearlyPay());
      return result;
    },

    getTaxesPerHour: function() {
      var result = this.getTotalTaxLiability() / Number(this.get('payable_hours'));
      return result;
    },

    getHourlyCostOfServices: function() {
      var payPerHour = this.getHourlyPay();
      var expensesPerHour = this.getExpensesPerHour();
      var taxesPerHour = this.getTaxesPerHour();
      var hourlyCosts = payPerHour + expensesPerHour + taxesPerHour;
      return hourlyCosts;
    },

    calculate: function() {
      if(this.calculate_lock) {
        return false;
      }

      this.calculate_lock = true;
      
      this.taxes.each(function(tax) { tax.calculateHourlyTax(); });
      this.expenses.each(function(expense) { expense.calculateHourlyExpense();});

      var hourlyCostOfServices = this.getHourlyCostOfServices();
      var baseBillRate = hourlyCostOfServices * Number(this.get('payable_hours')) / Number(this.get('billable_hours'));
      var result = baseBillRate + (baseBillRate * (Number(this.get('margin'))/100));
      result = result.toFixed(2);
      this.set({suggested_bill_rate: result});

      this.calculate_lock = false;
      return result;
    }
  });

  Tax = Backbone.Model.extend({
    defaults: {name:'',amount:0,cap:0,hourly_tax_liability:0},
    initialize: function() {
      this.bind('change',this.calculateHourlyTax,this);
    },

    validate: function(attr) {
      if(!_.isUndefined(attr.name) && attr.name.trim() == '') {
        return 'Name is required';
      }

      if(!_.isUndefined(attr.amount) && !validateRequiredPositiveNumber(attr.amount)) {
        return 'Tax amount is required.  It must be a number greater than 0.';
      }

      if(!_.isUndefined(attr.cap) && attr.cap != '' && !validateNumber(attr.cap,0)) {
        return 'On First amount must be a number greater than or equal to 0 when it is specified';
      }
    },

    getTotalTaxLiability: function(yearlyPay) {
      var amount_to_tax = yearlyPay;
      var cap = Number(this.get('cap'));
      var amount = Number(this.get('amount'));

      if(cap > 0 && cap < yearlyPay) {
        amount_to_tax = cap;
      }

      var result = amount_to_tax * (amount / 100);
      return result;
    },

    calculateHourlyTax: function() {
      var numberOfHours = Number(this.calculator.get('payable_hours'));
      var yearlyPay = Number(this.calculator.getYearlyPay());
      var totalTaxLiability = this.getTotalTaxLiability(yearlyPay);
      var result = totalTaxLiability / numberOfHours;
      result = result.toFixed(4);
      this.set({hourly_tax_liability:result});
    }
  });

  TaxesCollection = Backbone.Collection.extend({
    model: Tax,

    getTotal: function(yearlyPay) {
      var result = this.reduce(function(seed,tax) {
        var taxAmount = tax.getTotalTaxLiability(yearlyPay);
        var runner = seed + taxAmount;
        return runner;
      },0);

      return result;
    }
  });

  Expense = Backbone.Model.extend({
    defaults: {name:'',amount:0,hourly_amount:0},
    initialize: function() {
      this.bind('change',this.calculateHourlyExpense,this);
    },

    validate: function(attr) {
      if(!_.isUndefined(attr.name) && attr.name.trim() == '') {
        return 'Name is required';
      }
     
      if(!_.isUndefined(attr.amount) && !validateRequiredPositiveNumber(attr.amount)) {
        return 'Expense amount is required.  It must be a number greater than 0.';
      }  
    },

    calculateHourlyExpense: function() {
      var numberOfHours = Number(this.calculator.get('payable_hours'));
      var result = Number(this.get('amount')) / numberOfHours;
      result = result.toFixed(4);
      this.set({hourly_amount:result});
    }
  });

  ExpensesCollection = Backbone.Collection.extend({
    model: Expense,

    getTotal: function() {
      var result = this.reduce(function(seed,expense) { 
        var expenseVal = expense.get('amount');
        var runner = seed + expenseVal;
        return runner;
      },0);
      return result;
    }
  });

  ExpenseView = Backbone.View.extend({
    tagName: 'li',
    className: 'span-24',
    template: _.template($('#expense_template').html()),
    editTemplate: _.template($('#expense_form_template').html()),

    events: {
      'click .edit': 'edit',
      'click .delete': 'deletex'
    },

    initialize: function() {
      _.bindAll(this,'render','edit','deletex','hide','show');
      this.model.bind('change',this.render);
    },

    render: function() {
      $(this.el).html(this.template(this.model.toJSON()));
      return this;
    },

    edit: function() {
      var editDialog = this.editTemplate(this.model.toJSON());
      var thisThis = this;
      $(editDialog)
        .appendTo('body')
        .dialog({
          modal:true,
          buttons: {
            ok: function() {
              var dialog = $(this);
              var form = $(dialog).children('form');
              var name = $(form).find('#name').val();
              var amount = Number($(form).find('#amount').val());
              var newObj = {name:name,amount:amount};
              var result = thisThis.model.set(newObj,{error: function(model,error) {
                alert('Error: ' + error);
              }});
              if(result != false) {
                thisThis.show();
                dialog.remove();
              };
            },
            close: function() {
              var dialog = $(this);
              if(thisThis.isHidden()) {
                thisThis.model.destroy();
                thisThis.remove();
              }
              dialog.remove();
            }
          }
        });
    },

    deletex: function() {
      this.model.destroy();
      this.remove();
    },

    hide: function() {
      $(this.el).addClass('hidden');
      return this;
    },

    isHidden: function() {
      return $(this.el).hasClass('hidden'); 
    },

    show: function() {
      $(this.el).removeClass('hidden');
      return this;
    }
  });

  TaxView = Backbone.View.extend({
    tagName: 'li',
    className: 'span-24',
    template: _.template($('#tax_template').html()),
    editTemplate: _.template($('#tax_form_template').html()),
    events: {
      'click .edit': 'edit',
      'click .delete': 'deletex'
    },

    initialize: function() {
      _.bindAll(this,'render','edit','deletex','hide','show');
      this.model.bind('change',this.render);
    },

    render: function() {
      $(this.el).html(this.template(this.model.toJSON()));
      return this;
    },

    edit: function() {
      var editDialog = this.editTemplate(this.model.toJSON());
      var thisThis = this;
      $(editDialog)
        .appendTo('body')
        .dialog({
          modal: true,
          buttons: {
            ok: function() {
              var dialog = $(this);
              var form = $(dialog).children('form');
              var name = $(form).find('#name').val();
              var amount = Number($(form).find('#amount').val());
              var cap = Number($(form).find('#cap').val());
              var newObj = {name:name,amount:amount,cap:cap};
              var result = thisThis.model.set(newObj,{error: function(model,error) {
                alert('Error: ' + error);
              }});
              if(result != false) {
                thisThis.show();
                dialog.remove();
              }
            },
            close: function() {
              var dialog = $(this);
              if(thisThis.isHidden()){
                thisThis.model.destroy();
                thisThis.remove();
              }
              dialog.remove();
            }
          }
        });
    },

    deletex: function() {
      this.model.destroy();
      this.remove();
    },

    hide: function() {
      $(this.el).addClass('hidden');
      return this;
    },

    isHidden: function() {
      return $(this.el).hasClass('hidden');
    },

    show: function() {
      $(this.el).removeClass('hidden');
      return this;
    }
  });

  AppView = Backbone.View.extend({
    el: $('#rate_calculator'),
    
    events: {
      "change input": "setChangesOnModel",
      "change select": "setChangesOnModel",
      "click #add_expense": "newExpense",
      "click #add_tax": "newTax",
    },

    initialize: function() {
      _.bindAll(this,'setChangesOnModel','render');
      this.model.bind('change',this.render,this);

      this.model.expenses.each(function(expense) {
        this.renderExpenseView(expense);
      },this);

      this.model.taxes.each(function(tax) {
        this.renderTaxView(tax);
      },this);

      this.render();
    },

    render: function(evt) {
      
      $('#suggested_bill_rate').text(this.model.get('suggested_bill_rate'));
      $('#total_tax_liability').text(this.model.getTotalTaxLiability().toFixed(2));
      $('#total_expenses').text(this.model.getTotalExpenses().toFixed(2));
      $('#billable_hours').val(this.model.get('billable_hours'));
      $('#payable_hours').val(this.model.get('payable_hours'));
      $('#pay').val(this.model.get('pay'));
      $('#pay_type').val(this.model.get('pay_type'));
      $('#margin').val(this.model.get('margin'));

      return this;
    },

    setChangesOnModel: function(evt) {
      var changed = evt.currentTarget;
      var value = $('#'+changed.id).val();
      var data = {};
      data[changed.id] = value;
      this.model.set(data);
    },

    newExpense: function() {
      var expense = new Expense;
      expense.calculator = this.model;
      this.model.expenses.add(expense,{silent:true});
      
      var view = this.renderExpenseView(expense);
      view.hide();
      view.edit();
     
      return false;
    },

    renderExpenseView: function(expense) {
      var view = new ExpenseView({model:expense});
      $('#expenses').append(view.render().el);
      return view;
    },

    newTax: function() {
      var tax = new Tax;
      tax.calculator = this.model;
      this.model.taxes.add(tax,{silent:true});

      var view = this.renderTaxView(tax);
      view.hide();
      view.edit();

      return false;
    },

    renderTaxView: function(tax) {
      var view = new TaxView({model:tax});
      $('#taxes').append(view.render().el);
      return view;
    }
  });

  var calculator = new Calculator;

  // federal payroll taxes
  calculator.taxes.add({name:'FICA Social Security',amount:6.2,cap:106800});
  calculator.taxes.add({name:'FICA Medicare',amount:1.45,cap:0});
  calculator.taxes.add({name:'FUTA',amount:6.2,cap:7000});

  // TX state payroll taxes
  calculator.taxes.add({name:'TX SUI',amount:8.25,cap:9000});

  // basic expenses
  calculator.expenses.add({name:'Medical Insurance',amount:12000});
  calculator.expenses.add({name:'Training',amount:10000});
  calculator.expenses.add({name:'Equipment',amount:3000});
  calculator.expenses.add({name:'Licenses',amount:3000});
  calculator.expenses.add({name:'Misc',amount:5000});

  var view = new AppView({model:calculator});
});

